import type { Attachment, ChatState } from './types';
import { MAX_ATTACHMENT_BYTES } from './media-limits';
import { withRequestDeadline } from './request-deadline';

const REFERENCE = /^\/api\/attachments\?messageId=([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})&index=([0-2])$/i;
const MAX_CACHED_BYTES = 64 * 1024 * 1024;
const MAX_CACHED_FILES = 128;
type Entry = { file: Attachment; status: 'queued' | 'loading' | 'ready' | 'error'; url: string; error?: string; touched: number; controller?: AbortController; done: Promise<void>; resolve: () => void };
type Source = { file: Attachment; evicted?: boolean };
type ObjectUrls = { create: (blob: Blob) => string; revoke: (url: string) => void };

export function privateMediaReference(value: string): string | undefined {
  const match = REFERENCE.exec(value);
  return match ? `/api/attachments?messageId=${match[1].toLowerCase()}&index=${match[2]}` : undefined;
}

// Only visible attachments request a download. The cache holds bounded binary
// object URLs in memory, never persists private media, and resets per account.
export class PrivateMediaCache {
  private identity = '';
  private revision = 0;
  private clock = 0;
  private sources = new Map<string, Source>();
  private entries = new Map<string, Entry>();
  private running = new Set<symbol>();

  constructor(
    private readonly fetchMedia: (source: string, signal: AbortSignal) => Promise<Response>,
    private readonly changed: () => void,
    private readonly urls: ObjectUrls = { create: blob => URL.createObjectURL(blob), revoke: url => URL.revokeObjectURL(url) },
    private readonly budget = { bytes: MAX_CACHED_BYTES, files: MAX_CACHED_FILES },
  ) {}

  reset(identity = '') {
    this.revision++;
    this.identity = identity;
    for (const entry of this.entries.values()) {
      entry.controller?.abort();
      if (entry.url) this.urls.revoke(entry.url);
      entry.resolve();
    }
    this.entries.clear();
    this.sources.clear();
    this.running.clear();
  }

  adopt(state: ChatState) {
    if (this.identity !== state.user.id) this.reset(state.user.id);
    const sources = new Map<string, Source>();
    for (const message of state.messages) for (const file of message.attachments) {
      const source = privateMediaReference(file.url);
      if (source) {
        const previous = this.sources.get(source);
        const same = previous && previous.file.type === file.type && previous.file.size === file.size && previous.file.name === file.name;
        sources.set(source, { file, evicted: same ? previous.evicted : false });
      }
    }
    this.sources = sources;
    for (const [source, entry] of this.entries) {
      const file = sources.get(source)?.file;
      if (!file || file.type !== entry.file.type || file.size !== entry.file.size || file.name !== entry.file.name) this.remove(source, entry);
    }
  }

  materialize(state: ChatState): ChatState {
    return { ...state, messages: state.messages.map(message => ({ ...message, attachments: message.attachments.map(file => {
      const source = privateMediaReference(file.url);
      if (!source) return file;
      const entry = this.entries.get(source);
      const evicted = this.sources.get(source)?.evicted;
      return { ...file, url: entry?.status === 'ready' ? entry.url : '', loading: !evicted && entry?.status !== 'ready' && entry?.status !== 'error', error: entry?.error ?? (evicted ? 'This file was cleared from memory. Retry to load it again.' : undefined) };
    }) })) };
  }

  load(sourceValue: string, retry = false): Promise<void> {
    const source = privateMediaReference(sourceValue);
    const reference = source && this.sources.get(source);
    if (!source || !reference || !this.identity || (reference.evicted && !retry)) return Promise.resolve();
    const file = reference.file;
    reference.evicted = false;
    const previous = this.entries.get(source);
    if (previous) {
      previous.touched = ++this.clock;
      if (previous.status !== 'error' || !retry) return previous.done;
      this.remove(source, previous);
    }
    let resolve: () => void = () => undefined;
    const done = new Promise<void>(complete => { resolve = complete; });
    const entry: Entry = { file, status: 'queued', url: '', touched: ++this.clock, done, resolve };
    this.entries.set(source, entry);
    this.trimEntries(source);
    this.changed();
    this.pump();
    return done;
  }

  abortPending(message = 'You’re offline. Reconnect, then retry this file.') {
    for (const entry of this.entries.values()) {
      if (entry.status === 'loading') entry.controller?.abort(new Error(message));
      else if (entry.status === 'queued') { entry.status = 'error'; entry.error = message; entry.resolve(); }
    }
    this.changed();
  }

  private remove(source: string, entry: Entry) {
    entry.controller?.abort();
    if (entry.url) this.urls.revoke(entry.url);
    entry.resolve();
    this.entries.delete(source);
  }

  private retire(source: string, entry: Entry) {
    // Keep only an eviction flag alongside the already-known metadata, not a
    // cached entry/blob. Visible rows must require an explicit retry instead of
    // racing each other to re-download a working set larger than the budget.
    const reference = this.sources.get(source);
    if (reference) reference.evicted = true;
    this.remove(source, entry);
  }

  private trimEntries(keep: string) {
    while (this.entries.size > this.budget.files) {
      const oldest = [...this.entries.entries()].filter(([source]) => source !== keep).sort((a, b) => a[1].touched - b[1].touched)[0];
      if (!oldest) return;
      this.retire(oldest[0], oldest[1]);
    }
  }

  private pump() {
    while (this.running.size < 2) {
      const queued = [...this.entries.entries()].find(([, entry]) => entry.status === 'queued');
      if (!queued) return;
      const [source, entry] = queued;
      entry.status = 'loading';
      const job = Symbol(source);
      this.running.add(job);
      void this.download(source, entry).finally(() => { this.running.delete(job); this.pump(); });
    }
  }

  private async download(source: string, entry: Entry) {
    const revision = this.revision;
    const controller = new AbortController();
    entry.controller = controller;
    const current = () => revision === this.revision && this.entries.get(source) === entry;
    try {
      if (!Number.isInteger(entry.file.size) || entry.file.size <= 0 || entry.file.size > MAX_ATTACHMENT_BYTES) throw new Error('This file is unavailable.');
      const blob = await withRequestDeadline(controller, 60000, async () => {
        const response = await this.fetchMedia(source, controller.signal);
        if (!response.ok) throw new Error(response.status === 404 || response.status === 403 ? 'This file is no longer available.' : 'Unable to load this file. Please retry.');
        if (response.headers.get('content-type')?.split(';')[0].trim() !== entry.file.type || Number(response.headers.get('content-length') ?? 0) > MAX_ATTACHMENT_BYTES) throw new Error('This file is unavailable.');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('This file is unavailable.');
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_ATTACHMENT_BYTES || size > entry.file.size) { await reader.cancel(); throw new Error('This file is unavailable.'); }
          chunks.push(Uint8Array.from(value));
        }
        if (size !== entry.file.size) throw new Error('This file is unavailable.');
        return new Blob(chunks, { type: entry.file.type });
      });
      if (!current()) return;
      entry.url = this.urls.create(blob);
      entry.status = 'ready';
      entry.error = undefined;
      entry.touched = ++this.clock;
      this.evict(source);
    } catch (failure) {
      if (!current()) return;
      entry.status = 'error';
      entry.error = failure instanceof Error ? failure.message : 'Unable to load this file. Please retry.';
    } finally {
      entry.controller = undefined;
      entry.resolve();
      if (current()) this.changed();
    }
  }

  private evict(keep: string) {
    let ready = [...this.entries.entries()].filter(([, entry]) => entry.status === 'ready');
    let size = ready.reduce((sum, [, entry]) => sum + entry.file.size, 0);
    ready.sort((a, b) => a[1].touched - b[1].touched);
    while (size > this.budget.bytes || ready.length > this.budget.files) {
      const index = ready.findIndex(([source]) => source !== keep);
      if (index === -1) return;
      const [source, entry] = ready.splice(index, 1)[0];
      size -= entry.file.size;
      this.retire(source, entry);
    }
  }
}

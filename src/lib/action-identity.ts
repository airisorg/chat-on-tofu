import type { ChatAction } from './types';

export const ACTION_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_ACTIONS = 64;
export const MAX_RECENT_ACTIONS = 10000;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

type NonSend = Exclude<ChatAction, { type: 'send' }>;
type Pending = { id: string; createdAt: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Only hashes, operation IDs and timestamps persist. Unconfirmed operations
// are never evicted to make room for a new one within their retry window.
export class PendingActionIds {
  private readonly ids = new Map<string, Pending>();
  private revision = 0;
  private identity = '';
  private readonly prefix = 'relay-chat-action-ids-v1:';
  private readonly identityKey = 'relay-chat-action-ids-last-identity-v1';
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

  constructor(
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
    private readonly now = () => Date.now(),
  ) {
    try {
      this.storage = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    } catch {}
  }

  bindVerifiedIdentity(identity: string) {
    if (this.identity === identity) return;
    this.revision++;
    this.ids.clear();
    this.identity = identity;
    // Storage can remain readable after quota or policy denies writes. Marker
    // cleanup must not prevent restoring this verified owner's existing IDs.
    let previous: string | null | undefined;
    try {
      previous = this.storage?.getItem(this.identityKey);
    } catch {}
    if (previous && previous !== identity)
      try {
        this.storage?.removeItem(this.prefix + previous);
      } catch {}
    try {
      this.storage?.setItem(this.identityKey, identity);
    } catch {}
    try {
      const raw = this.storage?.getItem(this.prefix + identity);
      if (!raw || raw.length > 18000) return;
      const saved = JSON.parse(raw) as { entries?: unknown };
      if (!Array.isArray(saved.entries) || saved.entries.length > MAX_PENDING_ACTIONS) return;
      for (const entry of saved.entries)
        if (
          Array.isArray(entry) &&
          entry.length === 3 &&
          typeof entry[0] === 'string' &&
          /^[0-9a-f]{64}$/.test(entry[0]) &&
          typeof entry[1] === 'string' &&
          UUID.test(entry[1]) &&
          typeof entry[2] === 'string' &&
          Number.isFinite(Date.parse(entry[2]))
        )
          this.ids.set(entry[0], { id: entry[1], createdAt: entry[2] });
    } catch {}
  }

  private persist() {
    if (!this.identity) return;
    try {
      if (this.ids.size)
        this.storage?.setItem(
          this.prefix + this.identity,
          JSON.stringify({
            entries: [...this.ids].map(([fingerprint, pending]) => [
              fingerprint,
              pending.id,
              pending.createdAt,
            ]),
          }),
        );
      else this.storage?.removeItem(this.prefix + this.identity);
    } catch {}
  }

  async prepare(action: NonSend) {
    const revision = this.revision;
    const { clientActionId: _id, clientActionCreatedAt: _at, ...logical } = action;
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonicalJson(logical)),
    );
    if (revision !== this.revision) throw new Error('Your account changed. Please try again.');
    const fingerprint = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    let pending = this.ids.get(fingerprint);
    if (pending && this.now() - Date.parse(pending.createdAt) >= ACTION_RETRY_WINDOW_MS) {
      this.ids.delete(fingerprint);
      this.persist();
      throw new Error(
        'This unconfirmed change’s retry window expired. Review the current state before trying again as a new change.',
      );
    }
    if (!pending) {
      if (this.ids.size >= MAX_PENDING_ACTIONS)
        throw new Error(
          'Too many changes are still unconfirmed. Retry them before making another change.',
        );
      pending = {
        id: action.clientActionId ?? crypto.randomUUID(),
        createdAt: action.clientActionCreatedAt ?? new Date(this.now()).toISOString(),
      };
      this.ids.set(fingerprint, pending);
      this.persist();
    }
    return {
      fingerprint,
      action: { ...action, clientActionId: pending.id, clientActionCreatedAt: pending.createdAt },
    };
  }

  acknowledge(fingerprint: string, id: string) {
    if (this.ids.get(fingerprint)?.id === id) {
      this.ids.delete(fingerprint);
      this.persist();
    }
  }

  clear(purge = false) {
    this.revision++;
    if (purge)
      try {
        const identity = this.identity || this.storage?.getItem(this.identityKey);
        if (identity) this.storage?.removeItem(this.prefix + identity);
        this.storage?.removeItem(this.identityKey);
      } catch {}
    this.ids.clear();
    this.identity = '';
  }
}

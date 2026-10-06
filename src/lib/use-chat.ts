'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, type RealtimeChannel, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { applyDemoAction, createDemoState, DEMO_STORAGE_KEY } from './demo';
import type { ChatAction, ChatController, ChatState } from './types';
import { MAX_DEMO_STORAGE_LENGTH } from './media-limits';
import { PrivateMediaCache } from './media-cache';
import { withRequestDeadline } from './request-deadline';
import { uploadAttachments } from './media-upload';
export { withRequestDeadline } from './request-deadline';

type Config = { supabaseUrl: string; supabaseAnonKey: string; databaseConfigured: boolean };
type Mode = 'guest' | 'auth' | 'demo';
const AUTH_STORAGE_KEY = 'relay-chat-auth-v1';
const DEMO_CHOICE_KEY = 'relay-chat-demo-choice-v1';
const DEMO_ALLOWED = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_DEMO === 'true';

export class PendingSendIds {
  private readonly ids = new Map<string, string>();
  private revision = 0;
  private identity = '';
  private readonly prefix = 'relay-chat-send-ids-v1:';
  private readonly identityKey = 'relay-chat-send-ids-last-identity-v1';
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

  constructor(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
    try { this.storage = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage); } catch { /* In-memory retry protection remains available. */ }
  }

  bindVerifiedIdentity(identity: string) {
    if (this.identity === identity) return;
    this.revision++;
    this.ids.clear();
    this.identity = identity;
    try {
      const previous = this.storage?.getItem(this.identityKey);
      if (previous && previous !== identity) this.storage?.removeItem(this.prefix + previous);
      this.storage?.setItem(this.identityKey, identity);
      const raw = this.storage?.getItem(this.prefix + identity);
      if (!raw || raw.length > 12000) return;
      const saved = JSON.parse(raw) as { version?: number; entries?: unknown };
      if (saved.version !== 1 || !Array.isArray(saved.entries)) return;
      for (const pair of saved.entries.slice(-64)) {
        if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && /^[0-9a-f]{64}$/.test(pair[0]) && typeof pair[1] === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pair[1])) this.ids.set(pair[0], pair[1]);
      }
    } catch { /* Damaged or unavailable browser storage uses memory only. */ }
  }

  private persist() {
    if (!this.identity) return;
    try {
      if (this.ids.size) this.storage?.setItem(this.prefix + this.identity, JSON.stringify({ version: 1, entries: [...this.ids] }));
      else this.storage?.removeItem(this.prefix + this.identity);
    } catch { /* Storage capacity/privacy restrictions preserve memory retries. */ }
  }

  async prepare(action: Extract<ChatAction, { type: 'send' }>) {
    const revision = this.revision;
    const logical = JSON.stringify([action.conversationId.toLowerCase(), action.text.trim(), action.parentId?.toLowerCase() ?? null, (action.attachments ?? []).map(file => [file.name,file.type,file.size,file.url])]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(logical));
    if (revision !== this.revision) throw new Error('Your account changed. Please try again.');
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
    const id = action.clientMessageId ?? this.ids.get(fingerprint) ?? crypto.randomUUID();
    this.ids.set(fingerprint, id);
    // Retain hashes/UUIDs only, never message text or media; bound memory use.
    if (this.ids.size > 64) this.ids.delete(this.ids.keys().next().value!);
    this.persist();
    return { fingerprint, action: { ...action, clientMessageId: id } };
  }

  acknowledge(fingerprint: string, id: string) { if (this.ids.get(fingerprint) === id) { this.ids.delete(fingerprint); this.persist(); } }
  clear(purge = false) {
    this.revision++;
    if (purge) {
      try {
        const identity = this.identity || this.storage?.getItem(this.identityKey);
        if (identity) this.storage?.removeItem(this.prefix + identity);
        this.storage?.removeItem(this.identityKey);
      } catch { /* Memory state still clears if storage is unavailable. */ }
    }
    this.ids.clear();
    this.identity = '';
  }
}

export function useChat(): ChatController {
  const [state, setState] = useState<ChatState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [authAvailable, setAuthAvailable] = useState(false);
  const [offline, setOffline] = useState(false);
  const stateRef = useRef<ChatState | null>(null);
  const configRef = useRef<Config | null>(null);
  const clientRef = useRef<SupabaseClient | null>(null);
  const modeRef = useRef<Mode>('guest');
  const tokenRef = useRef('');
  const identityRef = useRef('');
  const generation = useRef(0);
  const revision = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const syncing = useRef(false);
  const writing = useRef(false);
  const realtimeChannel = useRef<RealtimeChannel | null>(null);
  const realtimeIdentity = useRef('');
  const configureRealtime = useRef<((userId: string) => void) | null>(null);
  const eventDirty = useRef(false);
  const dismissed = useRef(false);
  const mounted = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSends = useRef(new PendingSendIds());
  const wireState = useRef<ChatState | null>(null);
  const mediaChanged = useRef<() => void>(() => undefined);
  const mediaCache = useRef<PrivateMediaCache | null>(null);
  if (!mediaCache.current) mediaCache.current = new PrivateMediaCache(async (source, signal) => {
    if (!navigator.onLine) throw new Error('You’re offline. Reconnect, then retry this file.');
    return fetch(source, { signal, cache: 'no-store', headers: { Authorization: `Bearer ${tokenRef.current}` } });
  }, () => mediaChanged.current());
  mediaChanged.current = () => {
    if (!mounted.current || modeRef.current !== 'auth' || !wireState.current || wireState.current.user.id !== identityRef.current) return;
    const next = mediaCache.current!.materialize(wireState.current);
    stateRef.current = next;
    setState(next);
  };

  const publish = useCallback((next: ChatState | null) => {
    if (next && modeRef.current === 'auth') {
      wireState.current = next;
      mediaCache.current!.adopt(next);
      next = mediaCache.current!.materialize(next);
    } else wireState.current = null;
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);

  const stopRealtime = useCallback(() => {
    const channel = realtimeChannel.current;
    realtimeChannel.current = null;
    realtimeIdentity.current = '';
    eventDirty.current = false;
    if (channel && clientRef.current) void clientRef.current.removeChannel(channel).catch(() => undefined);
  }, []);

  const reset = useCallback((mode: Mode, identity = '', token = '') => {
    generation.current++;
    revision.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    pendingSends.current.clear();
    mediaCache.current?.reset();
    writing.current = false;
    stopRealtime();
    modeRef.current = mode;
    identityRef.current = identity;
    tokenRef.current = token;
    syncing.current = false;
    publish(null);
    if (mounted.current) {
      setDemo(mode === 'demo');
      setError(null);
      setLoading(mode === 'auth');
    }
  }, [publish, stopRealtime]);

  const request = useCallback(async (method: 'GET' | 'POST', action?: ChatAction) => {
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const timeout = method === 'GET' ? 8000 : action?.type === 'send' && action.attachments?.length ? 60000 : 20000;
      return await withRequestDeadline(controller, timeout, async () => {
      let body = action;
      if (action?.type === 'send' && action.attachments?.length) body = await uploadAttachments(action, async chunk => {
        const uploaded = await fetch('/api/uploads', {
          method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { Authorization: `Bearer ${tokenRef.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        });
        const payload = await uploaded.json() as { ok?: boolean; error?: string };
        if (!uploaded.ok || payload.ok !== true) {
          const failure = new Error(payload.error || 'Unable to upload this file. Retry your message.') as Error & { status: number };
          failure.status = uploaded.status;
          throw failure;
        }
      }, controller.signal);
      const response = await fetch('/api/chat', {
        method, cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Bearer ${tokenRef.current}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json() as { state?: ChatState; id?: string; error?: string };
      if (!response.ok) {
        const failure = new Error(payload.error || 'Chat is temporarily unavailable.') as Error & { status: number };
        failure.status = response.status;
        throw failure;
      }
      if (!payload.state?.user || payload.state.user.id !== identityRef.current) throw new Error('Your account changed. Please sign in again.');
      return payload as { state: ChatState; id?: string };
      });
    } finally { controllers.current.delete(controller); }
  }, []);

  const sync = useCallback(async (): Promise<void> => {
    if (modeRef.current !== 'auth' || syncing.current || writing.current || !navigator.onLine || document.hidden || !tokenRef.current) return;
    const start = generation.current;
    const version = revision.current;
    syncing.current = true;
    eventDirty.current = false;
    try {
      const result = await request('GET');
      if (start !== generation.current || version !== revision.current || modeRef.current !== 'auth') return;
      pendingSends.current.bindVerifiedIdentity(result.state.user.id);
      publish(result.state);
      configureRealtime.current?.(result.state.user.id);
      if (mounted.current) setError(null);
    } catch (failure) {
      if (start !== generation.current || (failure instanceof Error && failure.name === 'AbortError')) return;
      if ((failure as Error & { status?: number }).status === 401) {
        dismissed.current = true;
        reset('guest');
        if (mounted.current) setError('Your session expired. Please sign in again.');
      } else if (mounted.current) setError(failure instanceof Error ? failure.message : 'Unable to connect to chat.');
    } finally {
      if (start === generation.current) {
        syncing.current = false;
        if (mounted.current) setLoading(false);
        if (eventDirty.current && !writing.current) queueMicrotask(() => { void sync(); });
      }
    }
  }, [publish, request, reset]);

  const startDemo = useCallback(() => {
    if (!DEMO_ALLOWED) return;
    reset('demo');
    try { localStorage.setItem(DEMO_CHOICE_KEY, 'yes'); } catch { /* Demo works without storage. */ }
    let next = createDemoState();
    try {
      const raw = localStorage.getItem(DEMO_STORAGE_KEY);
      if (raw && raw.length <= MAX_DEMO_STORAGE_LENGTH) {
        const saved = JSON.parse(raw) as ChatState;
        // This key is solely the explicit demo. Never read auth/private chat into it.
        if (saved.user?.id === 'demo-you' && Array.isArray(saved.conversations) && Array.isArray(saved.messages) && saved.conversations.every(c => Array.isArray(c.members)) && saved.messages.every(m => Array.isArray(m.attachments) && Array.isArray(m.reactions) && m.author?.id)) next = saved;
      }
    } catch { /* A damaged demo resets to the examples. */ }
    publish(next);
    setLoading(false);
  }, [publish, reset]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let bootstrap: AbortController | null = null;
    let initializing = false;
    let initialized = false;
    const accept = (session: Session | null) => {
      if (disposed || modeRef.current === 'demo' || (dismissed.current && session)) return;
      if (!session) { reset('guest'); return; }
      if (modeRef.current !== 'auth' || identityRef.current !== session.user.id) reset('auth', session.user.id, session.access_token);
      else tokenRef.current = session.access_token;
      if (clientRef.current && realtimeChannel.current) void clientRef.current.realtime.setAuth(session.access_token).catch(() => undefined);
      // Do not await Supabase calls inside its auth-state callback lock.
      queueMicrotask(() => { if (!disposed) void sync(); });
    };
    const restoreDemo = () => {
      if (!DEMO_ALLOWED) return false;
      try { if (localStorage.getItem(DEMO_CHOICE_KEY) === 'yes') { startDemo(); return true; } } catch { /* Private browsing may disable storage. */ }
      return false;
    };
    const initialize = async () => {
      if (disposed || initializing || initialized) return;
      initializing = true;
      const controller = new AbortController();
      bootstrap = controller;
      controllers.current.add(controller);
      try {
        const config = await withRequestDeadline(controller, 8000, async () => {
          const response = await fetch('/api/config', { cache: 'no-store', signal: controller.signal });
          if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Unable to load sign-in settings.');
          return await response.json() as Config;
        });
        controllers.current.delete(controller);
        if (!config || typeof config.supabaseUrl !== 'string' || typeof config.supabaseAnonKey !== 'string' || typeof config.databaseConfigured !== 'boolean') throw new Error('Unable to load sign-in settings.');
        let valid = false;
        try { const url = new URL(config.supabaseUrl); valid = url.protocol === 'https:' && !url.username && !url.password && Boolean(config.supabaseAnonKey) && config.databaseConfigured === true; } catch { /* Unconfigured local preview remains a guest. */ }
        if (disposed) return;
        configRef.current = config;
        setAuthAvailable(valid);
        if (!valid) { initialized = true; if (!restoreDemo()) setLoading(false); return; }
        const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: AUTH_STORAGE_KEY },
        });
        clientRef.current = client;
        initialized = true;
        configureRealtime.current = (userId: string) => {
          // The API has already verified this identity before this subscription.
          if (disposed || realtimeIdentity.current === userId || modeRef.current !== 'auth') return;
          stopRealtime();
          realtimeIdentity.current = userId;
          const start = generation.current;
          void client.realtime.setAuth(tokenRef.current).then(() => {
            if (disposed || start !== generation.current || modeRef.current !== 'auth' || realtimeIdentity.current !== userId) return;
            realtimeChannel.current = client.channel(`relay-events-${userId}`).on('postgres_changes', {
              event: 'INSERT', schema: 'relay', table: 'events', filter: `user_id=eq.${userId}`,
            }, () => {
              if (disposed || start !== generation.current || identityRef.current !== userId) return;
              eventDirty.current = true;
              void sync();
            }).subscribe();
          }).catch(() => { if (start === generation.current) realtimeIdentity.current = ''; });
        };
        const { data: listener } = client.auth.onAuthStateChange((_event, session) => accept(session));
        unsubscribe = () => listener.subscription.unsubscribe();
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const { data, error: authError } = await withRequestDeadline(controller, 8000, () => client.auth.getSession());
        if (disposed) return;
        // Callback tokens must never remain in the visible URL or browser history.
        if (hash.has('access_token') || hash.has('refresh_token') || hash.has('error')) window.history.replaceState(null, '', window.location.pathname + window.location.search);
        if (data.session || !restoreDemo()) accept(data.session);
        if (authError || hash.has('error')) setError('Google sign-in did not complete. Please try again.');
      } catch (failure) {
        if (!disposed && !(failure instanceof Error && failure.name === 'AbortError')) {
          restoreDemo();
          setError('Unable to connect. Check your connection and refresh the page.');
          setLoading(false);
        }
      } finally { controllers.current.delete(controller); initializing = false; }
    };
    const connectivity = () => {
      setOffline(!navigator.onLine);
      if (!navigator.onLine) {
        controllers.current.forEach(controller => controller.abort(new Error('You’re offline. Reconnect to continue.')));
        mediaCache.current?.abortPending();
      }
      else { if (!initialized) void initialize(); void sync(); }
    };
    const visibility = () => { if (!document.hidden) void sync(); };
    connectivity();
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    document.addEventListener('visibilitychange', visibility);
    const timer = window.setInterval(() => { void sync(); }, 3000);
    void initialize();
    return () => {
      disposed = true;
      mounted.current = false;
      generation.current++;
      syncing.current = false;
      bootstrap?.abort();
      controllers.current.forEach(c => c.abort());
      controllers.current.clear();
      pendingSends.current.clear();
      mediaCache.current?.reset();
      stopRealtime();
      configureRealtime.current = null;
      unsubscribe?.();
      clientRef.current?.auth.stopAutoRefresh();
      clientRef.current = null;
      window.clearInterval(timer);
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [reset, startDemo, stopRealtime, sync]);

  const loadMedia = useCallback((messageId: string, index: number, retry = false) => {
    if (modeRef.current !== 'auth' || !wireState.current || wireState.current.user.id !== identityRef.current) return;
    const file = wireState.current.messages.find(message => message.id === messageId)?.attachments[index];
    if (file) void mediaCache.current?.load(file.url, retry);
  }, []);
  const loadAttachment = useCallback((messageId: string, index: number) => loadMedia(messageId, index), [loadMedia]);
  const retryAttachment = useCallback((messageId: string, index: number) => loadMedia(messageId, index, true), [loadMedia]);

  const action = useCallback((value: ChatAction): Promise<string | undefined> => {
    const start = generation.current;
    const pending = queue.current.catch(() => undefined).then(async () => {
      if (start !== generation.current) throw new Error('Your account changed. Please try again.');
      if (!navigator.onLine) throw new Error('You’re offline. Reconnect before making changes.');
      if (modeRef.current === 'demo') {
        if (!stateRef.current) throw new Error('Start the demo first.');
        const result = applyDemoAction(stateRef.current, value);
        publish(result.state);
        try { localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(result.state)); } catch { /* Storage may be disabled or full; the active demo still works. */ }
        setError(null);
        return result.id;
      }
      if (modeRef.current !== 'auth' || !tokenRef.current) throw new Error('Sign in to continue.');
      if (stateRef.current?.user.id !== identityRef.current) throw new Error('Wait for your account to finish connecting.');
      pendingSends.current.bindVerifiedIdentity(stateRef.current.user.id);
      const prepared = value.type === 'send' ? await pendingSends.current.prepare(value) : null;
      if (start !== generation.current) throw new Error('Your account changed. Please try again.');
      if (!navigator.onLine) throw new Error('You’re offline. Reconnect before making changes.');
      revision.current++;
      writing.current = true;
      try {
        const result = await request('POST', prepared?.action ?? value);
        if (start !== generation.current || modeRef.current !== 'auth') throw new Error('Your account changed. Please try again.');
        revision.current++;
        publish(result.state);
        if (prepared && result.id === prepared.action.clientMessageId) pendingSends.current.acknowledge(prepared.fingerprint, result.id);
        setError(null);
        return result.id;
      } finally {
        writing.current = false;
        if (start === generation.current && eventDirty.current) queueMicrotask(() => { void sync(); });
      }
    }).catch(failure => {
      if (start === generation.current && mounted.current) {
        if ((failure as Error & { status?: number }).status === 401) {
          dismissed.current = true;
          reset('guest');
        }
        setError(failure instanceof Error ? failure.message : 'Unable to complete this action.');
      }
      throw failure;
    });
    queue.current = pending;
    return pending;
  }, [publish, request, reset, sync]);

  const signIn = useCallback(() => {
    if (!authAvailable || !configRef.current || !navigator.onLine) { setError('Google sign-in is unavailable. Please try again when you’re connected.'); return; }
    dismissed.current = false;
    try { localStorage.removeItem(DEMO_CHOICE_KEY); } catch { /* Demo preference is optional. */ }
    const url = new URL('https://oauth.trytofu.ai/start');
    url.searchParams.set('return', `${window.location.origin}/`);
    window.location.assign(url.href);
  }, [authAvailable]);

  const signOut = useCallback(async () => {
    dismissed.current = true;
    pendingSends.current.clear(true);
    reset('guest');
    try { localStorage.removeItem(AUTH_STORAGE_KEY); localStorage.removeItem(DEMO_CHOICE_KEY); } catch { /* Private browsing may disable storage. */ }
    const client = clientRef.current;
    if (client) {
      try { await client.auth.signOut({ scope: 'local' }); } catch { /* Local state was already cleared. */ }
      client.auth.stopAutoRefresh();
    }
  }, [reset]);

  return { state, loading, error, demo, authAvailable, offline, action, signIn, signOut, startDemo, loadAttachment, retryAttachment, clearError: useCallback(() => setError(null), []) };
}

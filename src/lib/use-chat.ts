'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, type RealtimeChannel, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { applyDemoAction, createDemoState, DEMO_STORAGE_KEY } from './demo';
import type { ChatAction, ChatController, ChatState } from './types';

type Config = { supabaseUrl: string; supabaseAnonKey: string; databaseConfigured: boolean };
type Mode = 'guest' | 'auth' | 'demo';
const AUTH_STORAGE_KEY = 'relay-chat-auth-v1';
const DEMO_CHOICE_KEY = 'relay-chat-demo-choice-v1';
const DEMO_ALLOWED = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_DEMO === 'true';

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

  const publish = useCallback((next: ChatState | null) => {
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
      const response = await fetch('/api/chat', {
        method, cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Bearer ${tokenRef.current}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        body: action ? JSON.stringify(action) : undefined,
      });
      const payload = await response.json() as { state?: ChatState; id?: string; error?: string };
      if (!response.ok) {
        const failure = new Error(payload.error || 'Chat is temporarily unavailable.') as Error & { status: number };
        failure.status = response.status;
        throw failure;
      }
      if (!payload.state?.user || payload.state.user.id !== identityRef.current) throw new Error('Your account changed. Please sign in again.');
      return payload as { state: ChatState; id?: string };
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
      if (raw && raw.length < 5_000_000) {
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
    const bootstrap = new AbortController();
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
      try {
        const response = await fetch('/api/config', { cache: 'no-store', signal: bootstrap.signal });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Unable to load sign-in settings.');
        const config = await response.json() as Config;
        if (!config || typeof config.supabaseUrl !== 'string' || typeof config.supabaseAnonKey !== 'string' || typeof config.databaseConfigured !== 'boolean') throw new Error('Unable to load sign-in settings.');
        let valid = false;
        try { const url = new URL(config.supabaseUrl); valid = url.protocol === 'https:' && !url.username && !url.password && Boolean(config.supabaseAnonKey) && config.databaseConfigured === true; } catch { /* Unconfigured local preview remains a guest. */ }
        if (disposed) return;
        configRef.current = config;
        setAuthAvailable(valid);
        if (!valid) { if (!restoreDemo()) setLoading(false); return; }
        const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: AUTH_STORAGE_KEY },
        });
        clientRef.current = client;
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
        const { data, error: authError } = await client.auth.getSession();
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
      }
    };
    const connectivity = () => { setOffline(!navigator.onLine); if (navigator.onLine) void sync(); };
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
      bootstrap.abort();
      controllers.current.forEach(c => c.abort());
      controllers.current.clear();
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
      revision.current++;
      writing.current = true;
      try {
        const result = await request('POST', value);
        if (start !== generation.current || modeRef.current !== 'auth') throw new Error('Your account changed. Please try again.');
        revision.current++;
        publish(result.state);
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
    reset('guest');
    try { localStorage.removeItem(AUTH_STORAGE_KEY); localStorage.removeItem(DEMO_CHOICE_KEY); } catch { /* Private browsing may disable storage. */ }
    const client = clientRef.current;
    if (client) {
      try { await client.auth.signOut({ scope: 'local' }); } catch { /* Local state was already cleared. */ }
      client.auth.stopAutoRefresh();
    }
  }, [reset]);

  return { state, loading, error, demo, authAvailable, offline, action, signIn, signOut, startDemo, clearError: useCallback(() => setError(null), []) };
}

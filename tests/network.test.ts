import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  authenticatedFetch,
  refreshFailure,
  type AuthSnapshot,
} from '../src/lib/authenticated-fetch';
import {
  ACTION_RETRY_WINDOW_MS,
  MAX_PENDING_ACTIONS,
  PendingActionIds,
  canonicalJson,
} from '../src/lib/action-identity';
import { PendingSendIds } from '../src/lib/use-chat';
import type { ChatAction } from '../src/lib/types';

const storageFixture = () => {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  };
};

test('only an actual auth rejection retries one exact operation after refresh', async () => {
  let snapshot: AuthSnapshot = { identity: 'alice', token: 'old-fixture', generation: 1 };
  let refreshed = 0;
  const attempts: { token: string; body: string }[] = [];
  const body = JSON.stringify({
    type: 'create',
    name: 'Private fixture',
    clientActionId: crypto.randomUUID(),
  });
  const response = await authenticatedFetch(
    async (token) => {
      attempts.push({ token, body });
      return new Response(null, { status: attempts.length === 1 ? 401 : 200 });
    },
    () => snapshot,
    async () => {
      refreshed++;
      snapshot = { ...snapshot, token: 'new-fixture' };
      return snapshot;
    },
    new AbortController().signal,
  );
  assert.equal(response.status, 200);
  assert.equal(refreshed, 1);
  assert.deepEqual(attempts, [
    { token: 'old-fixture', body },
    { token: 'new-fixture', body },
  ]);
});

test('no mutation retries on lost acknowledgement, rate limit, outage or forbidden access', async () => {
  const snapshot = { identity: 'alice', token: 'fixture', generation: 1 };
  let refreshed = 0;
  for (const status of [200, 403, 429, 503]) {
    let calls = 0;
    const response = await authenticatedFetch(
      async () => {
        calls++;
        return new Response(null, { status });
      },
      () => snapshot,
      async () => {
        refreshed++;
        return snapshot;
      },
      new AbortController().signal,
    );
    assert.equal(response.status, status);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(
    authenticatedFetch(
      async () => {
        calls++;
        throw new TypeError('Synthetic lost response');
      },
      () => snapshot,
      async () => {
        refreshed++;
        return snapshot;
      },
      new AbortController().signal,
    ),
    /lost response/,
  );
  assert.equal(calls, 1);
  assert.equal(refreshed, 0);
});

test('auth retries stop after one refresh, and a token already renewed avoids another refresh', async () => {
  let snapshot = { identity: 'alice', token: 'old', generation: 1 },
    calls = 0,
    refreshes = 0;
  const result = await authenticatedFetch(
    async () => {
      calls++;
      return new Response(null, { status: 401 });
    },
    () => snapshot,
    async () => {
      refreshes++;
      return { ...snapshot, token: 'new' };
    },
    new AbortController().signal,
  );
  assert.equal(result.status, 401);
  assert.equal(calls, 2);
  assert.equal(refreshes, 1);
  calls = 0;
  refreshes = 0;
  await authenticatedFetch(
    async (token) => {
      calls++;
      if (calls === 1) snapshot = { ...snapshot, token: 'concurrently-renewed' };
      return new Response(null, { status: token === 'old' ? 401 : 200 });
    },
    () => snapshot,
    async () => {
      refreshes++;
      return snapshot;
    },
    new AbortController().signal,
  );
  assert.equal(calls, 2);
  assert.equal(refreshes, 0);
});

test('refresh outages retain retryable503 classification while revoked sessions produce401', async () => {
  for (const input of [new TypeError('Synthetic outage'), { status: 503 }, { status: 429 }])
    assert.equal(refreshFailure(input).status, 503);
  for (const input of [
    { status: 400 },
    { status: 401 },
    { status: 403 },
    { name: 'AuthSessionMissingError' },
  ])
    assert.equal(refreshFailure(input).status, 401);
  let calls = 0;
  await assert.rejects(
    authenticatedFetch(
      async () => {
        calls++;
        return new Response(null, { status: 401 });
      },
      () => ({ identity: 'alice', token: 'old', generation: 1 }),
      async () => {
        throw refreshFailure({ status: 503 });
      },
      new AbortController().signal,
    ),
    (error: unknown) => (error as { status: number }).status === 503,
  );
  assert.equal(calls, 1);
});

test('account change or offline abort during auth refresh never sends a late retry', async () => {
  for (const mode of ['account', 'abort']) {
    let snapshot = { identity: 'alice', token: 'old', generation: 1 },
      calls = 0;
    const controller = new AbortController();
    await assert.rejects(
      authenticatedFetch(
        async () => {
          calls++;
          return new Response(null, { status: 401 });
        },
        () => snapshot,
        async () => {
          if (mode === 'account') snapshot = { identity: 'bob', token: 'other', generation: 2 };
          else controller.abort(new Error('Synthetic offline abort'));
          return { identity: 'alice', token: 'renewed' };
        },
        controller.signal,
      ),
      mode === 'account' ? /account changed/ : /offline abort/,
    );
    assert.equal(calls, 1);
  }
});

test('all mutation identities survive reload without payload storage and renew only after acknowledgement', async () => {
  const { values, storage } = storageFixture();
  const first = new PendingActionIds(storage);
  first.bindVerifiedIdentity('alice');
  const action: Exclude<ChatAction, { type: 'send' }> = {
    type: 'create',
    name: 'Private space name',
    kind: 'space',
    emails: ['private-fixture@example.invalid'],
    description: 'Private description',
  };
  const prepared = await first.prepare(action);
  first.clear();
  assert.equal([...values.values()].join('').includes(action.name), false);
  assert.equal([...values.values()].join('').includes(action.emails[0]), false);
  const reloaded = new PendingActionIds(storage);
  reloaded.bindVerifiedIdentity('alice');
  const retry = await reloaded.prepare({
    description: action.description,
    emails: action.emails,
    kind: 'space',
    name: action.name,
    type: 'create',
  });
  assert.equal(retry.action.clientActionId, prepared.action.clientActionId);
  assert.equal(retry.action.clientActionCreatedAt, prepared.action.clientActionCreatedAt);
  reloaded.acknowledge(retry.fingerprint, retry.action.clientActionId);
  assert.notEqual(
    (await reloaded.prepare(action)).action.clientActionId,
    prepared.action.clientActionId,
  );
  reloaded.bindVerifiedIdentity('bob');
  assert.equal(values.has('relay-chat-action-ids-v1:alice'), false);
  reloaded.clear(true);
  assert.equal(values.has('relay-chat-action-ids-v1:bob'), false);
});

test('bounded unconfirmed sends and mutations reject new intents while preserving the oldest retry across reload', async () => {
  for (const kind of ['send', 'mutation']) {
    const { storage } = storageFixture();
    const ids = kind === 'send' ? new PendingSendIds(storage) : new PendingActionIds(storage);
    ids.bindVerifiedIdentity('alice');
    const sends = new PendingSendIds(storage);
    const mutations = new PendingActionIds(storage);
    const prepare = (number: number) =>
      kind === 'send'
        ? (ids as PendingSendIds).prepare({
            type: 'send',
            conversationId: '11111111-1111-4111-8111-111111111111',
            text: `Intent ${number}`,
          })
        : (ids as PendingActionIds).prepare({ type: 'profile', status: `Intent ${number}` });
    const first = await prepare(0);
    for (let index = 1; index < MAX_PENDING_ACTIONS; index++) await prepare(index);
    await assert.rejects(prepare(MAX_PENDING_ACTIONS), /Too many/);
    const retry = await prepare(0);
    assert.equal(canonicalJson(retry.action), canonicalJson(first.action));
    ids.clear();
    const restored = kind === 'send' ? sends : mutations;
    restored.bindVerifiedIdentity('alice');
    const retried =
      kind === 'send'
        ? await sends.prepare({
            type: 'send',
            conversationId: '11111111-1111-4111-8111-111111111111',
            text: 'Intent 0',
          })
        : await mutations.prepare({ type: 'profile', status: 'Intent 0' });
    assert.equal(canonicalJson(retried.action), canonicalJson(first.action));
  }
});

test('expired mutation identity is rejected before an explicitly warned fresh attempt', async () => {
  let now = Date.now();
  const ids = new PendingActionIds(storageFixture().storage, () => now);
  ids.bindVerifiedIdentity('alice');
  const action = { type: 'profile' as const, status: 'Private intent' };
  const first = await ids.prepare(action);
  now += ACTION_RETRY_WINDOW_MS;
  await assert.rejects(ids.prepare(action), /retry window expired.*new change/);
  assert.notEqual((await ids.prepare(action)).action.clientActionId, first.action.clientActionId);
});

test('opposite desired star or reaction state is a new intent after later reconciliation', async () => {
  const ids = new PendingActionIds(storageFixture().storage);
  ids.bindVerifiedIdentity('alice');
  const messageId = '11111111-1111-4111-8111-111111111111';
  const starred = await ids.prepare({ type: 'star', messageId, starred: true });
  const removed = await ids.prepare({ type: 'star', messageId, starred: false });
  assert.notEqual(starred.action.clientActionId, removed.action.clientActionId);
  const reacted = await ids.prepare({ type: 'react', messageId, emoji: '👍', active: true });
  const undone = await ids.prepare({ type: 'react', messageId, emoji: '👍', active: false });
  assert.notEqual(reacted.action.clientActionId, undone.action.clientActionId);
  assert.equal(
    (await ids.prepare({ type: 'star', messageId, starred: true })).action.clientActionId,
    starred.action.clientActionId,
  );
});

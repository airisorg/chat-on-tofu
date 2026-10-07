import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import { MAX_PENDING_ACTIONS, PendingActionIds } from '../src/lib/action-identity';
import { applySchema, getChat, mutateChat } from '../src/lib/server';
import { sqlAdapter } from './helpers/pglite-sql';

const action = {
  type: 'create' as const,
  kind: 'space' as const,
  name: 'Recovery fixture',
  emails: [],
};

function storageFixture() {
  const values = new Map<string, string>();
  let blocked: 'set' | 'remove' | 'both' | undefined;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (blocked === 'set' || blocked === 'both')
        throw new DOMException('Synthetic storage write limit', 'QuotaExceededError');
      values.set(key, value);
    },
    removeItem: (key: string) => {
      if (blocked === 'remove' || blocked === 'both')
        throw new DOMException('Synthetic storage cleanup restriction', 'SecurityError');
      values.delete(key);
    },
  };
  return {
    values,
    storage,
    block: (operation: typeof blocked) => {
      blocked = operation;
    },
  };
}

for (const blocked of ['set', 'remove'] as const) {
  test(`readable mutation metadata restores when ${blocked}Item fails`, async () => {
    const fixture = storageFixture();
    const before = new PendingActionIds(fixture.storage);
    before.bindVerifiedIdentity('alice');
    const original = await before.prepare(action);
    // A different last-identity marker exercises cleanup separately from writes.
    if (blocked === 'remove') fixture.values.set('relay-chat-action-ids-last-identity-v1', 'bob');
    fixture.block(blocked);
    const reopened = new PendingActionIds(fixture.storage);
    reopened.bindVerifiedIdentity('alice');
    const retry = await reopened.prepare(action);
    assert.equal(retry.action.clientActionId, original.action.clientActionId);
    assert.equal(retry.action.clientActionCreatedAt, original.action.clientActionCreatedAt);
    assert.equal([...fixture.values.values()].join('').includes(action.name), false);
  });
}

test('read-only recovery loads only the verified owner namespace', async () => {
  const alice = storageFixture(),
    bob = storageFixture();
  const aliceIds = new PendingActionIds(alice.storage);
  aliceIds.bindVerifiedIdentity('alice');
  const alicePrepared = await aliceIds.prepare(action);
  const bobIds = new PendingActionIds(bob.storage);
  bobIds.bindVerifiedIdentity('bob');
  const bobPrepared = await bobIds.prepare(action);
  // Both namespaces can remain when account cleanup is denied. Reads must
  // still select the verified identity, rather than the last-identity marker.
  alice.values.set('relay-chat-action-ids-v1:bob', bob.values.get('relay-chat-action-ids-v1:bob')!);
  alice.block('both');
  const reopened = new PendingActionIds(alice.storage);
  reopened.bindVerifiedIdentity('bob');
  const bobRetry = await reopened.prepare(action);
  assert.equal(bobRetry.action.clientActionId, bobPrepared.action.clientActionId);
  assert.notEqual(bobRetry.action.clientActionId, alicePrepared.action.clientActionId);
  reopened.bindVerifiedIdentity('alice');
  assert.equal(
    (await reopened.prepare(action)).action.clientActionId,
    alicePrepared.action.clientActionId,
  );
});

test('read-only metadata restores the full capacity without evicting the oldest unresolved intent', async () => {
  const fixture = storageFixture();
  const before = new PendingActionIds(fixture.storage);
  before.bindVerifiedIdentity('alice');
  const original = await before.prepare(action);
  for (let index = 1; index < MAX_PENDING_ACTIONS; index++)
    await before.prepare({ ...action, name: `Recovery fixture ${index}` });
  fixture.block('both');
  const reopened = new PendingActionIds(fixture.storage);
  reopened.bindVerifiedIdentity('alice');
  assert.equal(
    (await reopened.prepare(action)).action.clientActionId,
    original.action.clientActionId,
  );
  await assert.rejects(
    reopened.prepare({ ...action, name: 'New intent beyond the capacity' }),
    /Too many changes/,
  );
  const saved = JSON.parse(fixture.values.get('relay-chat-action-ids-v1:alice')!) as {
    entries: unknown[];
  };
  assert.equal(saved.entries.length, MAX_PENDING_ACTIONS);
});

test('an account change during mutation hashing cannot repopulate either owner with the old intent', async () => {
  const fixture = storageFixture();
  const ids = new PendingActionIds(fixture.storage);
  ids.bindVerifiedIdentity('alice');
  const preparing = ids.prepare(action);
  ids.bindVerifiedIdentity('bob');
  await assert.rejects(preparing, /account changed/);
  assert.equal(fixture.values.has('relay-chat-action-ids-v1:alice'), false);
  assert.equal(fixture.values.has('relay-chat-action-ids-v1:bob'), false);
  const fresh = await ids.prepare(action);
  assert.equal(
    JSON.parse(fixture.values.get('relay-chat-action-ids-v1:bob')!).entries[0][1],
    fresh.action.clientActionId,
  );
});

test('lost create acknowledgement plus read-only reload replays one real SQL receipt and event', async () => {
  const pg = new PGlite();
  const sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
  const owner: User = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'owner@action-recovery.invalid',
    email_confirmed_at: '2026-10-05T00:00:00Z',
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: { full_name: 'Recovery owner' },
    created_at: '2026-10-05T00:00:00Z',
  };
  const fixture = storageFixture();
  try {
    await applySchema(sql);
    await getChat(owner, sql);
    const before = new PendingActionIds(fixture.storage);
    before.bindVerifiedIdentity(owner.id);
    const original = await before.prepare(action);
    const committed = await mutateChat(owner, original.action, sql);
    // Model a committed POST whose response was lost: no client acknowledge.
    fixture.block('both');
    const reopened = new PendingActionIds(fixture.storage);
    reopened.bindVerifiedIdentity(owner.id);
    const retry = await reopened.prepare(action);
    const result = await mutateChat(owner, retry.action, sql);
    assert.equal(
      (await pg.query('select * from relay.conversations')).rows.length,
      1,
      'the retry must not create another space',
    );
    assert.equal(
      (await pg.query('select * from relay.operations')).rows.length,
      1,
      'one receipt proves the same persisted intent',
    );
    assert.equal((await pg.query('select * from relay.participants')).rows.length, 1);
    assert.equal(
      (await pg.query('select * from relay.events')).rows.length,
      1,
      'receipt replay must not emit another event',
    );
    assert.equal(result.id, committed.id);
    assert.equal(result.actionId, original.action.clientActionId);
  } finally {
    await pg.close();
  }
});

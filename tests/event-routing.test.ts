import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import type { ChatAction } from '../src/lib/types';
import { applySchema, ChatError, getChat, getChatResult, mutateChat } from '../src/lib/server';
import { sqlAdapter } from './helpers/pglite-sql';

function account(label: string): User {
  return { id: crypto.randomUUID(), email: `${label}@event-security.invalid`, email_confirmed_at: new Date().toISOString(), aud: 'authenticated', app_metadata: {}, user_metadata: { full_name: label }, created_at: new Date().toISOString() };
}

async function fixture() {
  const pg = new PGlite(), sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const [owner, peer, foreignOwner, foreignPeer] = ['owner', 'peer', 'foreign-owner', 'foreign-peer'].map(account);
  try {
    await applySchema(sql);
    for (const user of [owner, peer, foreignOwner, foreignPeer]) await getChat(user, sql);
    const conversationId = (await mutateChat(owner, { type: 'create', kind: 'group', name: 'Owned group', emails: [peer.email!] }, sql)).id!;
    const foreignConversationId = (await mutateChat(foreignOwner, { type: 'create', kind: 'group', name: 'Foreign group', emails: [foreignPeer.email!] }, sql)).id!;
    const messageId = (await mutateChat(owner, { type: 'send', conversationId, text: 'Original owned message' }, sql)).id!;
    await pg.exec('DELETE FROM relay.events');
    return { pg, sql, owner, peer, foreignOwner, foreignPeer, conversationId, foreignConversationId, messageId };
  } catch (error) { await pg.close(); throw error; }
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function snapshot(pg: PGlite) {
  const values: unknown[] = [];
  // Static fixture table names only. Capture effects beyond the event rows too.
  for (const table of ['profiles', 'conversations', 'participants', 'invites', 'messages', 'reactions', 'stars', 'operations', 'events']) {
    values.push((await pg.query(`SELECT coalesce(jsonb_agg(row ORDER BY row::text),'[]'::jsonb) AS rows FROM relay.${table} row`)).rows);
  }
  return values;
}

async function assertEvents(f: Fixture, recipients: string[], conversationId: string | null) {
  const rows = (await f.pg.query<{user_id: string; conversation_id: string | null}>('SELECT user_id,conversation_id FROM relay.events ORDER BY user_id')).rows;
  assert.deepEqual(rows.map(row => row.user_id), [...recipients].sort());
  assert.ok(rows.every(row => row.conversation_id === conversationId), 'all events target the authorized resource');
}

test('surplus foreign or nonexistent conversation IDs reject all affected actions without any writes', async () => {
  const f = await fixture();
  try {
    const actions: ChatAction[] = [
      { type: 'edit', messageId: f.messageId, text: 'Must not be saved' },
      { type: 'delete', messageId: f.messageId },
      { type: 'react', messageId: f.messageId, emoji: '👍', active: true },
      { type: 'star', messageId: f.messageId, starred: true },
      { type: 'profile', name: 'Must not be saved', status: 'Must not be saved' },
      { type: 'create', kind: 'space', name: 'Must not be created', emails: [f.peer.email!] },
    ];
    const before = await snapshot(f.pg);
    for (const action of actions) for (const conversationId of [f.foreignConversationId, crypto.randomUUID()]) {
      const input = { ...action, conversationId, clientActionId: crypto.randomUUID(), clientActionCreatedAt: new Date().toISOString() };
      await assert.rejects(mutateChat(f.owner, input, f.sql), error => error instanceof ChatError && error.status === 400 && /unsupported fields/.test(error.message), `${action.type} must reject a surplus event target`);
      assert.deepEqual(await snapshot(f.pg), before, `${action.type} rejection must leave message/profile/conversation/preferences/receipts/events untouched`);
      assert.equal((await getChatResult(f.owner, input.clientActionId, f.sql)).actionId, undefined);
    }
    await assert.rejects(mutateChat(f.owner, { type: 'profile', status: 'Must not be saved', unexpected: true }, f.sql), /unsupported fields/);
    await assert.rejects(mutateChat(f.owner, { type: '__proto__' }, f.sql), /valid action/);
    assert.deepEqual(await snapshot(f.pg), before);
  } finally { await f.pg.close(); }
});

test('authorized message actions route shared and personal events correctly and receipts replay once', async () => {
  const f = await fixture();
  try {
    const actions: ChatAction[] = [
      { type: 'edit', messageId: f.messageId, text: 'Saved edit' },
      { type: 'react', messageId: f.messageId, emoji: '🇬🇷', active: true },
      { type: 'star', messageId: f.messageId, starred: true },
      { type: 'delete', messageId: f.messageId },
    ];
    for (const action of actions) {
      await f.pg.exec('DELETE FROM relay.events');
      const envelope = { ...action, clientActionId: crypto.randomUUID(), clientActionCreatedAt: new Date().toISOString() };
      const first = await mutateChat(f.owner, envelope, f.sql);
      await assertEvents(f, action.type === 'star' ? [f.owner.id] : [f.owner.id, f.peer.id], f.conversationId);
      const beforeReplay = await snapshot(f.pg);
      const replay = await mutateChat(f.owner, envelope, f.sql);
      assert.equal(replay.actionId, first.actionId);
      assert.deepEqual(await snapshot(f.pg), beforeReplay, `${action.type} receipt replay emits no events or other mutation`);
      assert.ok(replay.state.conversations.every(c => c.id !== f.foreignConversationId));
    }
    assert.equal((await getChat(f.peer, f.sql)).messages.find(message => message.id === f.messageId)?.deleted, true);
  } finally { await f.pg.close(); }
});

test('current conversation/profile client contracts preserve recipients, read silence and created resource identity', async () => {
  const f = await fixture();
  try {
    const shared: ChatAction[] = [
      { type: 'conversation', conversationId: f.conversationId, name: 'Renamed group', description: 'Saved description' },
      { type: 'invite', conversationId: f.conversationId, emails: ['invited@event-security.invalid'] },
    ];
    for (const action of shared) {
      await f.pg.exec('DELETE FROM relay.events');
      await mutateChat(f.owner, action, f.sql);
      await assertEvents(f, [f.owner.id, f.peer.id], f.conversationId);
    }
    await f.pg.exec('DELETE FROM relay.events');
    const preference = await mutateChat(f.owner, { type: 'conversation', conversationId: f.conversationId, pinned: true, muted: true, section: 'Work' }, f.sql);
    await assertEvents(f, [f.owner.id], f.conversationId);
    assert.equal(preference.state.conversations.find(c => c.id === f.conversationId)?.pinned, true);
    await f.pg.exec('DELETE FROM relay.events');
    await mutateChat(f.owner, { type: 'read', conversationId: f.conversationId, unread: true }, f.sql);
    await assertEvents(f, [], null);
    await mutateChat(f.owner, { type: 'profile', name: 'New own name', status: 'Busy' }, f.sql);
    await assertEvents(f, [f.owner.id, f.peer.id], null);
    await f.pg.exec('DELETE FROM relay.events');
    const envelope = { type: 'create', kind: 'group', name: 'New authorized group', description: 'New description', emails: [f.peer.email!], clientActionId: crypto.randomUUID(), clientActionCreatedAt: new Date().toISOString() } as const;
    const created = await mutateChat(f.owner, envelope, f.sql);
    assert.ok(created.id);
    await assertEvents(f, [f.owner.id, f.peer.id], created.id);
    const beforeReplay = await snapshot(f.pg);
    assert.equal((await mutateChat(f.owner, envelope, f.sql)).id, created.id);
    assert.deepEqual(await snapshot(f.pg), beforeReplay);
    await f.pg.exec('DELETE FROM relay.events');
    await mutateChat(f.peer, { type: 'leave', conversationId: created.id }, f.sql);
    await assertEvents(f, [f.owner.id], created.id);
    assert.ok((await getChat(f.peer, f.sql)).conversations.every(c => c.id !== created.id));
  } finally { await f.pg.close(); }
});

test('current send and legacy toggle fields work while unknown fields cannot smuggle a target', async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.from('small client file');
    const send = { type: 'send', conversationId: f.conversationId.toUpperCase(), clientMessageId: crypto.randomUUID(), text: 'Client send', attachments: [{ name: 'client.txt', type: 'text/plain', size: bytes.length, url: `data:text/plain;base64,${bytes.toString('base64')}` }] } as const;
    const sent = await mutateChat(f.owner, send, f.sql);
    await assertEvents(f, [f.owner.id, f.peer.id], f.conversationId);
    const beforeReplay = await snapshot(f.pg);
    assert.equal((await mutateChat(f.owner, send, f.sql)).id, sent.id);
    assert.deepEqual(await snapshot(f.pg), beforeReplay);
    await f.pg.exec('DELETE FROM relay.events');
    await mutateChat(f.owner, { type: 'react', messageId: sent.id!, emoji: '👍' }, f.sql);
    await assertEvents(f, [f.owner.id, f.peer.id], f.conversationId);
    await f.pg.exec('DELETE FROM relay.events');
    await mutateChat(f.owner, { type: 'star', messageId: sent.id! }, f.sql);
    await assertEvents(f, [f.owner.id], f.conversationId);
    const beforeInvalid = await snapshot(f.pg);
    await assert.rejects(mutateChat(f.owner, { ...send, clientMessageId: crypto.randomUUID(), targetConversationId: f.foreignConversationId }, f.sql), /unsupported fields/);
    assert.deepEqual(await snapshot(f.pg), beforeInvalid);
  } finally { await f.pg.close(); }
});

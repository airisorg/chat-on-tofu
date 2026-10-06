import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import { applySchema, getChat, mutateChat, ChatError } from '../src/lib/server';

import { sqlAdapter } from './helpers/pglite-sql';
function user(id: string, email: string, name: string): User {
  return { id, email, email_confirmed_at: '2026-10-05T00:00:00Z', aud: 'authenticated', app_metadata: {}, user_metadata: { full_name: name }, created_at: '2026-10-05T00:00:00Z' };
}

test('real PostgreSQL schema and two-account chat preserve membership and per-user isolation', async () => {
  const pg = new PGlite();
  const observed: string[] = [];
  const observe = (engine: { query: typeof pg.query }) => ({ query: async (query: string, parameters?: unknown[]) => { observed.push(query); return engine.query(query, parameters); } });
  const sql = sqlAdapter(observe(pg), callback => pg.transaction(tx => callback(observe(tx))));
  const alice = user('11111111-1111-4111-8111-111111111111', 'alice@example.com', 'Alice');
  const bob = user('22222222-2222-4222-8222-222222222222', 'bob@example.com', 'Bob');
  const outsider = user('33333333-3333-4333-8333-333333333333', 'outsider@example.com', 'Outsider');
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    await pg.exec(`CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; CREATE PUBLICATION supabase_realtime;`);
    await applySchema(sql);
    observed.length = 0;
    await applySchema(sql); // Already-installed migrations skip all DDL.
    assert.equal(observed.length, 3, 'installed schema requires only advisory lock and two metadata reads');
    assert.equal(observed.some(query => /CREATE|ALTER|REVOKE/i.test(query)), false);
    assert.equal((await pg.query('select version from relay.schema_migrations')).rows.length, 1);
    assert.equal((await pg.query<{ version: number }>('select version from relay.schema_migrations')).rows[0].version, 2);
    assert.equal((await pg.query("select * from pg_publication_tables where pubname='supabase_realtime' and schemaname='relay' and tablename='events'")).rows.length, 1);
    assert.deepEqual((await getChat(alice, sql)).conversations, []);
    const created = await mutateChat(alice, { type: 'create', name: 'Bob', kind: 'dm', emails: ['BOB@example.com'] }, sql);
    const conversationId = created.id!;
    assert.equal(created.state.conversations[0].members[1].status, 'Invited');
    const joined = await getChat(bob, sql);
    assert.equal(joined.conversations.length, 1);
    assert.equal(joined.conversations[0].id, conversationId);
    assert.equal(joined.conversations[0].name, 'Alice');
    assert.equal(joined.conversations[0].members.every(person => person.status !== 'Invited'), true);
    const png = Buffer.from([137,80,78,71,13,10,26,10,0]);
    const voice = Buffer.from([0x1a,0x45,0xdf,0xa3,0]);
    const message = await mutateChat(alice, { type: 'send', conversationId, text: 'Hello Bob', attachments: [
      { name: 'picture.png', type: 'image/png', size: png.length, url: `data:image/png;base64,${png.toString('base64')}` },
      { name: 'voice.webm', type: 'audio/webm', size: voice.length, url: `data:audio/webm;base64,${voice.toString('base64')}` },
    ] }, sql);
    const messageId = message.id!;
    const bobState = await getChat(bob, sql);
    assert.equal(bobState.messages[0].text, 'Hello Bob');
    assert.equal(bobState.messages[0].attachments.length, 2);
    assert.equal(bobState.conversations[0].unread, 1);
    const events = await pg.query<{ user_id: string; conversation_id: string }>('select * from relay.events');
    assert.equal(events.rows.some(row => row.user_id === alice.id && row.conversation_id === conversationId), true);
    assert.equal(events.rows.some(row => row.user_id === bob.id && row.conversation_id === conversationId), true);
    assert.deepEqual(Object.keys(events.rows[0]).sort(), ['id','user_id','conversation_id','created_at'].sort());
    const beforeRead = events.rows.length;
    await mutateChat(bob, { type: 'read', conversationId }, sql);
    assert.equal((await pg.query('select * from relay.events')).rows.length, beforeRead, 'read state never creates realtime feedback events');
    assert.equal((await getChat(outsider, sql)).messages.length, 0);
    assert.equal((await getChat(outsider, sql)).conversations.length, 0);
    for (const action of [
      { type: 'send', conversationId, text: 'Injection' },
      { type: 'react', messageId, emoji: '👍' },
      { type: 'star', messageId },
      { type: 'invite', conversationId, emails: ['outsider@example.com'] },
      { type: 'conversation', conversationId, name: 'Takeover' },
    ]) await assert.rejects(mutateChat(outsider, action, sql), (e: unknown) => e instanceof ChatError && e.status === 404);
    await assert.rejects(mutateChat(bob, { type: 'edit', messageId, text: 'Overwrite Alice' }, sql), (e: unknown) => e instanceof ChatError && e.status === 403);
    await assert.rejects(mutateChat(bob, { type: 'delete', messageId }, sql), (e: unknown) => e instanceof ChatError && e.status === 403);
    const reacted = await mutateChat(bob, { type: 'react', messageId, emoji: '👍' }, sql);
    assert.deepEqual(reacted.state.messages[0].reactions, [{ emoji: '👍', userIds: [bob.id] }]);
    await mutateChat(bob, { type: 'star', messageId }, sql);
    assert.equal((await getChat(bob, sql)).messages[0].starred, true);
    assert.equal((await getChat(alice, sql)).messages[0].starred, false);
    const reply = await mutateChat(bob, { type: 'send', conversationId, text: 'Hello Alice', parentId: messageId }, sql);
    assert.equal(reply.state.messages.find(m => m.id === reply.id)?.parentId, messageId);
    assert.equal((await getChat(alice, sql)).messages.length, 2);
    await mutateChat(bob, { type: 'read', conversationId }, sql);
    assert.equal((await getChat(bob, sql)).conversations[0].unread, 0);
    await mutateChat(bob, { type: 'read', conversationId, unread: true }, sql);
    assert.equal((await getChat(bob, sql)).conversations[0].unread, 1);
    await mutateChat(bob, { type: 'conversation', conversationId, pinned: true, muted: true, section: 'Friends' }, sql);
    assert.equal((await getChat(bob, sql)).conversations[0].pinned, true);
    assert.equal((await getChat(alice, sql)).conversations[0].pinned, false);
    await mutateChat(alice, { type: 'edit', messageId, text: 'Edited greeting' }, sql);
    assert.equal((await getChat(bob, sql)).messages[0].text, 'Edited greeting');
    const other = await mutateChat(alice, { type: 'create', name: 'Private space', kind: 'space', emails: [] }, sql);
    await assert.rejects(mutateChat(alice, { type: 'send', conversationId: other.id, text: 'Cross thread', parentId: messageId }, sql), /thread/);
    await assert.rejects(mutateChat(alice, { type: 'send', conversationId, text: 'x'.repeat(6001) }, sql), /6000/);
    await mutateChat(alice, { type: 'delete', messageId }, sql);
    const deleted = (await getChat(bob, sql)).messages.find(m => m.id === messageId)!;
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.attachments.length, 0);
    assert.equal(deleted.reactions.length, 0);
    await mutateChat(bob, { type: 'leave', conversationId }, sql);
    assert.equal((await getChat(bob, sql)).conversations.length, 0);
    await assert.rejects(mutateChat(bob, { type: 'send', conversationId, text: 'After leaving' }, sql), (e: unknown) => e instanceof ChatError && e.status === 404);
    await pg.exec('SET ROLE anon;');
    await assert.rejects(pg.query('SELECT * FROM relay.profiles'), /permission denied/);
    await pg.exec('RESET ROLE;');
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [alice.id]);
    await pg.exec('SET ROLE authenticated;');
    const ownEvents = await pg.query<{ user_id: string }>('select * from relay.events');
    assert.equal(ownEvents.rows.length > 0, true);
    assert.equal(ownEvents.rows.every(row => row.user_id === alice.id), true, 'Realtime event RLS isolates each verified identity');
    await assert.rejects(pg.query('SELECT * FROM relay.messages'), /permission denied/);
    await assert.rejects(pg.query('SELECT * FROM relay.profiles'), /permission denied/);
    await assert.rejects(pg.query("INSERT INTO relay.events(id,user_id) VALUES(gen_random_uuid(),'fake')"), /permission denied/);
    await pg.exec('RESET ROLE;');
  } finally { await pg.close(); }
});

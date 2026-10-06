import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import { applySchema, ChatError, getAttachment, getChat, getChatResult, mutateChat } from '../src/lib/server';
import { sqlAdapter } from './helpers/pglite-sql';

function user(label: string): User {
  return { id: crypto.randomUUID(), email: `${label}@read-test.invalid`, email_confirmed_at: '2026-10-05T00:00:00Z', aud: 'authenticated', app_metadata: {}, user_metadata: { full_name: label }, created_at: '2026-10-05T00:00:00Z' };
}

test('ordinary state reads skip invitation writes and read a current profile once per request', async () => {
  const pg = new PGlite(), queries: string[] = [];
  const observe = (engine: { query: typeof pg.query }) => ({ query: async (query: string, parameters?: unknown[]) => { queries.push(query); return engine.query(query, parameters); } });
  const sql = sqlAdapter(observe(pg), callback => pg.transaction(tx => callback(observe(tx))));
  const owner = user('poll-owner');
  try {
    await applySchema(sql); await getChat(owner, sql);
    const saved = await mutateChat(owner, { type: 'profile', name: 'Saved name', status: 'Away' }, sql);
    assert.equal(saved.state.user.name, 'Saved name', 'mutation acknowledgement reloads the profile after saving');
    assert.equal(saved.state.user.status, 'Away');
    queries.length = 0;
    const empty = await getChat(owner, sql);
    assert.equal(empty.user.name, 'Saved name'); assert.equal(empty.user.status, 'Away');
    assert.deepEqual(empty.conversations, []); assert.deepEqual(empty.messages, []);
    assert.equal(queries.length, 4, 'profile, conversations, combined roster and empty history');
    assert.ok(queries.every(query => !/\b(insert|update|delete)\b/i.test(query)), 'getChat state queries skip empty invitation writes; route request quotas are outside this function');
    await pg.query("update relay.profiles set name='Changed elsewhere',status='Busy' where id=$1", [owner.id]);
    assert.equal((await getChat(owner, sql)).user.name, 'Changed elsewhere', 'no profile is cached across requests');
    const conversationId = (await mutateChat(owner, { type: 'create', kind: 'space', name: 'Working set', emails: [] }, sql)).id!;
    const messageId = (await mutateChat(owner, { type: 'send', conversationId, text: 'One message' }, sql)).id!;
    queries.length = 0;
    const state = await getChat(owner, sql);
    assert.equal(state.messages[0].id, messageId);
    assert.equal(state.user.status, 'Busy');
    assert.equal(queries.length, 5, 'nonempty history adds the unchanged reaction query');
    assert.ok(queries.every(query => !/\b(insert|update|delete)\b/i.test(query)));
  } finally { await pg.close(); }
});

test('new and existing accounts claim fresh invitations and GET returns verified email and saved avatar changes', async () => {
  const pg = new PGlite(), sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const owner = user('inviter'), peer = user('pending-peer');
  try {
    await applySchema(sql); await getChat(owner, sql);
    const first = (await mutateChat(owner, { type: 'create', kind: 'group', name: 'First invitation', emails: [peer.email!] }, sql)).id!;
    assert.equal((await getChat(peer, sql)).conversations[0].id, first, 'first sign-in claims a pending invitation');
    assert.equal((await pg.query('select * from relay.invites where conversation_id=$1', [first])).rows.length, 0);
    const later = (await mutateChat(owner, { type: 'create', kind: 'space', name: 'After prior poll', emails: [peer.email!] }, sql)).id!;
    assert.ok((await getChat(peer, sql)).conversations.some(conversation => conversation.id === later), 'an invitation after a previous GET is not hidden by cached state');
    await mutateChat(peer, { type: 'profile', name: 'Custom name', status: 'Away' }, sql);
    const updated = { ...peer, email: 'changed-peer@read-test.invalid', user_metadata: { full_name: 'Provider name', avatar_url: 'https://lh3.googleusercontent.com/read-fixture.png' } };
    const changedEmail = (await mutateChat(owner, { type: 'create', kind: 'space', name: 'New verified address', emails: [updated.email] }, sql)).id!;
    const result = await getChat(updated, sql);
    assert.equal(result.user.email, updated.email);
    assert.equal(result.user.avatar, updated.user_metadata.avatar_url);
    assert.equal(result.user.name, 'Custom name'); assert.equal(result.user.status, 'Away');
    assert.ok(result.conversations.some(conversation => conversation.id === changedEmail));
    const stored = (await pg.query<{ email: string; avatar: string }>('select email,avatar from relay.profiles where id=$1', [peer.id])).rows[0];
    assert.equal(stored.email, result.user.email); assert.equal(stored.avatar, result.user.avatar);
    const next = await getChat({ ...updated, user_metadata: { avatar_url: 'https://lh3.googleusercontent.com/replacement.png' } }, sql);
    assert.equal(next.user.avatar, result.user.avatar, 'provider metadata does not overwrite an already saved avatar');
  } finally { await pg.close(); }
});

test('a verified email collision never reuses the profile or workspace of another identity', async () => {
  const pg = new PGlite(), sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const owner = user('collision-owner'), otherIdentity = { ...owner, id: crypto.randomUUID() };
  try {
    await applySchema(sql); await getChat(owner, sql);
    const action = { type: 'create', kind: 'space', name: 'Private identity', emails: [], clientActionId: crypto.randomUUID(), clientActionCreatedAt: new Date().toISOString() };
    const conversationId = (await mutateChat(owner, action, sql)).id!;
    const bytes = Buffer.from('private fixture');
    const messageId = (await mutateChat(owner, { type: 'send', conversationId, text: 'Private original account', attachments: [{ name: 'private.txt', type: 'text/plain', size: bytes.length, url: `data:text/plain;base64,${bytes.toString('base64')}` }] }, sql)).id!;
    await assert.rejects(getChat(otherIdentity, sql), (error: unknown) => error instanceof ChatError && error.status === 409);
    await assert.rejects(getChatResult(otherIdentity, action.clientActionId, sql), (error: unknown) => error instanceof ChatError && error.status === 409);
    await assert.rejects(mutateChat(otherIdentity, action, sql), (error: unknown) => error instanceof ChatError && error.status === 409);
    await assert.rejects(getAttachment(otherIdentity, messageId, 0, sql), (error: unknown) => error instanceof ChatError && error.status === 404);
    assert.equal((await pg.query('select * from relay.profiles where email=$1', [owner.email])).rows.length, 1);
    assert.equal((await pg.query('select * from relay.profiles where id=$1', [otherIdentity.id])).rows.length, 0);
    assert.equal((await pg.query('select * from relay.participants where user_id=$1', [otherIdentity.id])).rows.length, 0);
    assert.equal((await pg.query('select * from relay.operations where owner_id=$1', [otherIdentity.id])).rows.length, 0);
    assert.equal((await getChat(owner, sql)).messages[0].text, 'Private original account');
    assert.deepEqual((await getAttachment(owner, messageId, 0, sql)).bytes, bytes);
  } finally { await pg.close(); }
});

test('global history preserves tied ordering, message ownership and metadata across busy conversations', async () => {
  const pg = new PGlite(), sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const owner = user('history-owner'), peer = user('history-peer'), outsider = user('history-outsider');
  try {
    await applySchema(sql);
    for (const account of [owner, peer, outsider]) await getChat(account, sql);
    const owned: string[] = [];
    for (let index = 0; index < 3; index++) {
      owned.push((await mutateChat(owner, { type: 'create', kind: 'group', name: `Busy ${index}`, emails: [peer.email!] }, sql)).id!);
    }
    const foreign = (await mutateChat(outsider, { type: 'create', kind: 'space', name: 'Inaccessible', emails: [] }, sql)).id!;
    // Equal timestamps across conversations exercise the global UUID tiebreaker.
    // A newer inaccessible history must not displace any authorized messages.
    for (const [index, conversationId] of [...owned, foreign].entries()) {
      await pg.query(`insert into relay.messages(id,conversation_id,author_id,text,created_at,edited,deleted,attachment_metadata)
        select md5($1::text || ':' || n)::uuid,$1::uuid,$2,'Conversation ' || $3::text || ' message ' || n,
          '2026-10-05T00:00:00Z'::timestamptz + n * interval '1 second' + $4::int * interval '1 day',
          n % 17 = 0,n % 31 = 0,
          case when n % 29 = 0 then '[{"name":"note.txt","type":"text/plain","size":4}]'::jsonb else '[]'::jsonb end
        from generate_series(1,1005) n`, [conversationId, index === 3 ? outsider.id : peer.id, index, index === 3 ? 1 : 0]);
    }
    const decoratedId = (await pg.query<{ id: string }>('select id from relay.messages where conversation_id=$1 and not deleted order by created_at desc,id desc limit 1', [owned[0]])).rows[0].id;
    await pg.query('insert into relay.stars(message_id,user_id) values($1,$2)', [decoratedId, owner.id]);
    for (const account of [owner, peer]) {
      await pg.query("insert into relay.reactions(message_id,user_id,emoji) values($1,$2,'👍')", [decoratedId, account.id]);
    }
    async function verify() {
      // This oracle uses an unrestricted owned-message join and global LIMIT,
      // independently of the implementation's per-conversation working sets.
      const expected = (await pg.query<{ id: string; conversation_id: string; text: string; edited: boolean; deleted: boolean; attachment_metadata: unknown[] }>(`
        select m.id,m.conversation_id,m.text,m.edited,m.deleted,m.attachment_metadata
        from relay.messages m join relay.participants p on p.conversation_id=m.conversation_id
        where p.user_id=$1 order by m.created_at desc,m.id desc limit 2000`, [owner.id])).rows.reverse();
      const state = await getChat(owner, sql);
      assert.equal(state.messages.length, 2000);
      assert.deepEqual(state.messages.map(message => message.id), expected.map(message => message.id));
      for (const [index, message] of state.messages.entries()) {
        const row = expected[index];
        assert.equal(message.conversationId, row.conversation_id);
        assert.equal(message.author.id, peer.id);
        assert.equal(message.text, row.deleted ? '' : row.text);
        assert.equal(message.edited, row.edited); assert.equal(message.deleted, row.deleted);
        assert.deepEqual(message.attachments, row.deleted ? [] : row.attachment_metadata.map((metadata, attachmentIndex) => ({
          ...(metadata as object), url: `/api/attachments?messageId=${row.id}&index=${attachmentIndex}`,
        })));
      }
      assert.ok(state.messages.every(message => owned.includes(message.conversationId)));
      const decorated = state.messages.find(message => message.id === decoratedId)!;
      assert.equal(decorated.starred, true);
      assert.deepEqual(decorated.reactions, [{ emoji: '👍', userIds: [owner.id, peer.id].sort() }]);
      return state;
    }
    await verify();
    await mutateChat(owner, { type: 'leave', conversationId: owned[1] }, sql);
    const afterLeave = await verify();
    assert.ok(afterLeave.messages.every(message => message.conversationId !== owned[1]), 'membership is checked anew after leaving');
    assert.equal((await pg.query<{ count: number }>('select count(*)::int as count from relay.messages')).rows[0].count, 4020, 'selecting a history never deletes stored data');
  } finally { await pg.close(); }
});

test('combined roster preserves thirty reserved slots and does not expose another workspace', async () => {
  const pg = new PGlite(), sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const owner = user('roster-owner'), peer = user('roster-peer'), outsider = user('roster-outsider');
  const pending = Array.from({ length: 28 }, (_, index) => `waiting-${index}@read-test.invalid`);
  try {
    await applySchema(sql); for (const account of [owner, peer, outsider]) await getChat(account, sql);
    const avatar = 'https://lh3.googleusercontent.com/roster-fixture.png';
    await getChat({ ...peer, user_metadata: { avatar_url: avatar } }, sql);
    await mutateChat(peer, { type: 'profile', name: 'Saved roster name', status: 'Busy' }, sql);
    const conversationId = (await mutateChat(owner, { type: 'create', kind: 'group', name: 'Thirty slots', emails: [peer.email!, ...pending] }, sql)).id!;
    const secret = (await mutateChat(outsider, { type: 'create', kind: 'space', name: 'Outside workspace', emails: ['outside-invite@read-test.invalid'] }, sql)).id!;
    await mutateChat(outsider, { type: 'send', conversationId: secret, text: 'Private outside message' }, sql);
    for (const account of [owner, peer]) {
      const state = await getChat(account, sql), roster = state.conversations[0].members;
      assert.equal(state.conversations.length, 1); assert.equal(state.conversations[0].id, conversationId);
      assert.equal(roster.length, 30);
      assert.deepEqual(new Set(roster.filter(person => person.status !== 'Invited').map(person => person.id)), new Set([owner.id, peer.id]));
      assert.deepEqual(new Set(roster.filter(person => person.status === 'Invited').map(person => person.email)), new Set(pending));
      assert.ok(roster.filter(person => person.status === 'Invited').every(person => person.id === `invite:${person.email}` && person.name === person.email.split('@')[0] && person.color === '#6d7780'));
      const savedPeer = roster.find(person => person.id === peer.id)!;
      assert.equal(savedPeer.name, 'Saved roster name'); assert.equal(savedPeer.status, 'Busy'); assert.equal(savedPeer.avatar, avatar);
      assert.deepEqual(state.messages, []);
    }
    const isolated = await getChat(outsider, sql);
    assert.deepEqual(isolated.conversations.map(conversation => conversation.id), [secret]);
    assert.equal(isolated.messages[0].text, 'Private outside message');
    assert.ok(isolated.conversations[0].members.every(person => ![owner.id, peer.id].includes(person.id)));
  } finally { await pg.close(); }
});

test('many owned conversations retain chronological messages, personal flags and a departed author', async () => {
  const pg = new PGlite(), sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const owner = user('many-owner'), peer = user('departed-author');
  try {
    await applySchema(sql); await getChat(owner, sql); await getChat(peer, sql);
    const conversationId = (await mutateChat(owner, { type: 'create', kind: 'group', name: 'Original group', emails: [peer.email!] }, sql)).id!;
    const parentId = (await mutateChat(peer, { type: 'send', conversationId, text: 'Older author context' }, sql)).id!;
    await mutateChat(owner, { type: 'send', conversationId, text: 'Thread reply', parentId }, sql);
    await mutateChat(owner, { type: 'star', messageId: parentId, starred: true }, sql);
    await mutateChat(peer, { type: 'react', messageId: parentId, emoji: '👍', active: true }, sql);
    await mutateChat(owner, { type: 'conversation', conversationId, pinned: true, muted: true, section: 'Project' }, sql);
    await mutateChat(owner, { type: 'read', conversationId, unread: true }, sql);
    await mutateChat(peer, { type: 'leave', conversationId }, sql);
    for (let index = 0; index < 12; index++) {
      const id = (await mutateChat(owner, { type: 'create', kind: 'space', name: `Space ${index}`, emails: [] }, sql)).id!;
      await mutateChat(owner, { type: 'send', conversationId: id, text: `Message ${index}` }, sql);
    }
    const state = await getChat(owner, sql), group = state.conversations.find(conversation => conversation.id === conversationId)!;
    assert.equal(state.conversations.length, 13); assert.equal(state.messages.length, 14);
    assert.equal(group.pinned, true); assert.equal(group.muted, true); assert.equal(group.section, 'Project'); assert.equal(group.unread, 1);
    assert.deepEqual(group.members.map(person => person.id), [owner.id]);
    const parent = state.messages.find(message => message.id === parentId)!;
    assert.equal(parent.author.id, peer.id); assert.equal(parent.author.name, peer.user_metadata.full_name);
    assert.equal(parent.starred, true); assert.deepEqual(parent.reactions, [{ emoji: '👍', userIds: [peer.id] }]);
    assert.ok(state.messages.every((message, index) => index === 0 || Date.parse(message.createdAt) >= Date.parse(state.messages[index - 1].createdAt)));
    assert.ok(state.messages.filter(message => message.parentId).every(message => state.messages.some(parent => parent.id === message.parentId)));
    assert.deepEqual((await getChat(peer, sql)).conversations, []);
  } finally { await pg.close(); }
});

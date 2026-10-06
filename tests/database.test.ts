import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import type { ChatAction } from '../src/lib/types';
import { applySchema, getChat, getChatResult, mutateChat, getAttachment, attachmentResponse, ChatError, stageUpload, type UploadChunk } from '../src/lib/server';
import { ACTION_RETRY_WINDOW_MS, MAX_RECENT_ACTIONS } from '../src/lib/action-identity';
import { MAX_CONVERSATION_MEMBERS } from '../src/lib/chat-limits';
import { MAX_ATTACHMENT_BYTES, MAX_HISTORY_PAYLOAD_BYTES, MAX_UPLOAD_BODY_BYTES, UPLOAD_CHUNK_BYTES } from '../src/lib/media-limits';

import { sqlAdapter } from './helpers/pglite-sql';
function user(id: string, email: string, name: string): User {
  return { id, email, email_confirmed_at: '2026-10-05T00:00:00Z', aud: 'authenticated', app_metadata: {}, user_metadata: { full_name: name }, created_at: '2026-10-05T00:00:00Z' };
}

test('thirty total slots include pending invitations, bulk mixed recipients and concurrent additions', async () => {
  const pg=new PGlite(),sql=sqlAdapter(pg,callback=>pg.transaction(tx=>callback(tx)));
  const users=Array.from({length:MAX_CONVERSATION_MEMBERS},(_,index)=>user(crypto.randomUUID(),`member-${index}@cap-test.invalid`,`Member ${index}`));
  try{
    await applySchema(sql);for(const person of users)await getChat(person,sql);
    const owner=users[0],peer=users[1];
    const maximum=(await mutateChat(owner,{type:'create',kind:'group',name:'Thirty',emails:users.slice(1).map(person=>person.email)},sql)).id!;
    assert.equal((await getChat(owner,sql)).conversations.find(c=>c.id===maximum)!.members.length,MAX_CONVERSATION_MEMBERS);
    const count=(await pg.query('select * from relay.conversations')).rows.length;
    await assert.rejects(mutateChat(owner,{type:'create',kind:'group',name:'Too many',emails:[...users.slice(1).map(person=>person.email),'extra@cap-test.invalid']},sql),/up to 30 people/);
    assert.equal((await pg.query('select * from relay.conversations')).rows.length,count,'oversized creation fully rolls back');
    await mutateChat(owner,{type:'invite',conversationId:maximum,emails:[peer.email!,peer.email!]},sql);
    assert.equal((await getChat(owner,sql)).conversations.find(c=>c.id===maximum)!.members.length,MAX_CONVERSATION_MEMBERS,'duplicate invitations consume no extra slot');
    const pending=Array.from({length:27},(_,index)=>`pending-${index}@cap-test.invalid`);
    const mixed=(await mutateChat(owner,{type:'create',kind:'space',name:'Mixed',emails:[peer.email!,...pending]},sql)).id!;
    assert.equal((await getChat(owner,sql)).conversations.find(c=>c.id===mixed)!.members.length,29);
    assert.equal((await pg.query('select * from relay.invites where conversation_id=$1',[mixed])).rows.length,27,'mixed known and unknown emails are both inserted');
    const raced=await Promise.allSettled([
      mutateChat(owner,{type:'invite',conversationId:mixed,emails:['final-a@cap-test.invalid']},sql),
      mutateChat(peer,{type:'invite',conversationId:mixed,emails:['final-b@cap-test.invalid']},sql),
    ]);
    assert.equal(raced.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(raced.filter(result=>result.status==='rejected').length,1);
    const before=(await getChat(owner,sql)).conversations.find(c=>c.id===mixed)!;assert.equal(before.members.length,30);
    const claimed=user(crypto.randomUUID(),pending[0],'Claimed invitation');await getChat(claimed,sql);
    const after=(await getChat(owner,sql)).conversations.find(c=>c.id===mixed)!;assert.equal(after.members.length,30);assert.equal(after.members.find(person=>person.email===pending[0])!.id,claimed.id);
    await assert.rejects(mutateChat(owner,{type:'invite',conversationId:mixed,emails:['overflow@cap-test.invalid']},sql),/up to 30 people/);
  }finally{await pg.close();}
});

test('metadata migration preserves legacy binary data and history queries avoid the binary column', async () => {
  const pg=new PGlite();const observed:string[]=[];
  const observe=(engine:{query:typeof pg.query})=>({query:async(query:string,parameters?:unknown[])=>{observed.push(query);return engine.query(query,parameters);}});
  const sql=sqlAdapter(observe(pg),callback=>pg.transaction(tx=>callback(observe(tx))));
  const alice=user(crypto.randomUUID(),'metadata@test.invalid','Alice'),bob=user(crypto.randomUUID(),'member@test.invalid','Bob');
  try{
    await applySchema(sql);await getChat(alice,sql);
    const conversationId=(await mutateChat(alice,{type:'create',kind:'group',name:'Metadata',emails:[bob.email]},sql)).id!;await getChat(bob,sql);
    const bytes=Buffer.from([137,80,78,71,13,10,26,10,1]);
    const saved=await mutateChat(alice,{type:'send',conversationId,text:'Legacy',attachments:[{name:'legacy.png',type:'image/png',size:bytes.length,url:`data:image/png;base64,${bytes.toString('base64')}`}]},sql);
    await pg.exec('ALTER TABLE relay.messages DROP COLUMN attachment_metadata; DELETE FROM relay.schema_migrations WHERE version=5; INSERT INTO relay.schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;');
    await applySchema(sql);observed.length=0;
    const state=await getChat(bob,sql);assert.equal(state.messages[0].attachments[0].url,`/api/attachments?messageId=${saved.id}&index=0`);
    const metadata=(await pg.query<{attachment_metadata:unknown[]}>('select attachment_metadata from relay.messages where id=$1',[saved.id])).rows[0].attachment_metadata;
    assert.deepEqual(metadata,[{name:'legacy.png',type:'image/png',size:bytes.length}]);
    const history=observed.find(query=>/with selected as materialized/.test(query))!;assert.ok(history);assert.match(history,/cross join lateral/);assert.doesNotMatch(history,/jsonb_array_elements\(m\.attachments\)/);
    assert.deepEqual((await getAttachment(bob,saved.id,0,sql)).bytes,bytes);
    await mutateChat(alice,{type:'delete',messageId:saved.id},sql);
    assert.deepEqual((await pg.query<{attachment_metadata:unknown[]}>('select attachment_metadata from relay.messages where id=$1',[saved.id])).rows[0].attachment_metadata,[]);
  }finally{await pg.close();}
});

test('atomic receipts make every non-send mutation safe after lost acknowledgement without extra events', async () => {
  const pg = new PGlite(), sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const alice = user('11111111-1111-4111-8111-111111111111', 'alice@example.com', 'Alice');
  const bob = user('22222222-2222-4222-8222-222222222222', 'bob@example.com', 'Bob');
  const outsider = user('33333333-3333-4333-8333-333333333333', 'outsider@example.com', 'Outsider');
  try {
    await applySchema(sql); await getChat(alice, sql);
    const once = async (action: Exclude<ChatAction, {type:'send'}>) => {
      const input = { ...action, clientActionId:crypto.randomUUID(), clientActionCreatedAt:new Date().toISOString() };
      const first = await mutateChat(alice, input, sql);
      const count = (await pg.query('select * from relay.events')).rows.length;
      const retry = await mutateChat(alice, input, sql);
      assert.equal(retry.actionId, input.clientActionId); assert.equal(retry.id, first.id);
      assert.equal((await pg.query('select * from relay.events')).rows.length, count, `${action.type} replay emits no extra events`);
      const confirmed = await getChatResult(alice, input.clientActionId, sql);
      assert.equal(confirmed.actionId, input.clientActionId); assert.equal(confirmed.id, first.id);
      return { input, first, retry };
    };
    const created = await once({type:'create',kind:'space',name:'One space',emails:[bob.email!]});
    const conversationId = created.first.id!;
    assert.equal((await pg.query('select * from relay.conversations')).rows.length, 1);
    await getChat(bob, sql); await getChat(outsider, sql);
    const messageId = (await mutateChat(alice, {type:'send',conversationId,text:'Original'}, sql)).id!;
    const reaction = await once({type:'react',messageId,emoji:'👍'});
    assert.deepEqual(reaction.retry.state.messages[0].reactions,[{emoji:'👍',userIds:[alice.id]}]);
    const star = await once({type:'star',messageId}); assert.equal(star.retry.state.messages[0].starred,true);
    const removedStar = await once({type:'star',messageId,starred:false}); assert.equal(removedStar.retry.state.messages[0].starred,false);
    await once({type:'star',messageId,starred:true});
    const removedReaction = await once({type:'react',messageId,emoji:'👍',active:false}); assert.deepEqual(removedReaction.retry.state.messages[0].reactions,[]);
    await once({type:'react',messageId,emoji:'👍',active:true});
    const unread = await once({type:'read',conversationId,unread:true}); assert.equal(unread.retry.state.conversations[0].unread,1);
    await once({type:'read',conversationId,unread:false});
    const changed = await once({type:'conversation',conversationId,name:'Revised',description:'Description',pinned:true,muted:true,section:'Friends'});
    assert.equal(changed.retry.state.conversations[0].name,'Revised');
    assert.equal(changed.retry.state.conversations[0].pinned,true); assert.equal(changed.retry.state.conversations[0].muted,true); assert.equal(changed.retry.state.conversations[0].section,'Friends');
    await once({type:'invite',conversationId,emails:['new-invite@example.com']});
    assert.equal((await pg.query("select * from relay.invites where email='new-invite@example.com'")).rows.length,1);
    const profile = await once({type:'profile',name:'New Alice',status:'Away'}); assert.equal(profile.retry.state.user.status,'Away');
    const edit = await once({type:'edit',messageId,text:'Edited once'}); assert.equal(edit.retry.state.messages[0].text,'Edited once');
    const deleted = await once({type:'delete',messageId}); assert.equal(deleted.retry.state.messages[0].deleted,true);
    await assert.rejects(mutateChat(outsider,star.input,sql),(error:unknown)=>error instanceof ChatError && error.status===409);
    await assert.rejects(mutateChat(alice,{...star.input,type:'profile',status:'Different intent'},sql),(error:unknown)=>error instanceof ChatError && error.status===409);
    const privateReceipt = await getChatResult(outsider,created.input.clientActionId,sql); assert.equal(privateReceipt.actionId,undefined);
    const leave = await once({type:'leave',conversationId}); assert.deepEqual(leave.retry.state.conversations,[]);
    const revoked = await mutateChat(alice,created.input,sql); assert.deepEqual(revoked.state.conversations,[]); assert.deepEqual(revoked.state.messages,[]);
    assert.equal((await pg.query('select * from relay.conversations')).rows.length,1,'replay after revoked membership never creates or restores access');
    await assert.rejects(mutateChat(alice,{type:'react',messageId,emoji:'👍',clientActionId:crypto.randomUUID(),clientActionCreatedAt:new Date().toISOString()},sql),(error:unknown)=>error instanceof ChatError && error.status===404);
  } finally { await pg.close(); }
});

test('receipt transaction rollback, expiry and quota preserve unexpired retry identities', async () => {
  const pg = new PGlite(), sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const alice = user('11111111-1111-4111-8111-111111111111', 'alice@example.com', 'Alice');
  try {
    await applySchema(sql); await getChat(alice,sql);
    const invalidId=crypto.randomUUID();
    await assert.rejects(mutateChat(alice,{type:'profile',name:'x'.repeat(81),clientActionId:invalidId,clientActionCreatedAt:new Date().toISOString()},sql),/1 and 80/);
    assert.equal((await pg.query('select * from relay.operations where id=$1',[invalidId])).rows.length,0,'failed validation rolls back mutation and receipt');
    assert.equal((await getChat(alice,sql)).user.name,'Alice');
    const retained={type:'profile',status:'Retained intent',clientActionId:crypto.randomUUID(),clientActionCreatedAt:new Date().toISOString()};
    await mutateChat(alice,retained,sql);
    await pg.query("insert into relay.operations(id,owner_id,digest,expires_at) select gen_random_uuid(),$1,repeat('a',64),now()+interval '1 day' from generate_series(1,$2)",[alice.id,MAX_RECENT_ACTIONS-1]);
    await assert.rejects(mutateChat(alice,{type:'profile',status:'New intent',clientActionId:crypto.randomUUID(),clientActionCreatedAt:new Date().toISOString()},sql),(error:unknown)=>error instanceof ChatError && error.status===429);
    assert.equal((await pg.query('select * from relay.operations where id=$1',[retained.clientActionId])).rows.length,1);
    assert.equal((await mutateChat(alice,retained,sql)).actionId,retained.clientActionId,'existing retry works even at capacity');
    await pg.query("update relay.operations set expires_at=now()-interval '1 second' where id<>$1",[retained.clientActionId]);
    await mutateChat(alice,{type:'profile',status:'After cleanup',clientActionId:crypto.randomUUID(),clientActionCreatedAt:new Date().toISOString()},sql);
    assert.equal((await pg.query('select * from relay.operations where id=$1',[retained.clientActionId])).rows.length,1,'expired cleanup never evicts an unexpired receipt');
    await assert.rejects(mutateChat(alice,{type:'profile',status:'Too old',clientActionId:crypto.randomUUID(),clientActionCreatedAt:new Date(Date.now()-ACTION_RETRY_WINDOW_MS-1).toISOString()},sql),(error:unknown)=>error instanceof ChatError && error.status===409);
    assert.equal((await getChat(alice,sql)).user.status,'After cleanup');
  } finally { await pg.close(); }
});

test('schema upgrade preserves data and keeps operation receipts unavailable to browser roles', async () => {
  const pg = new PGlite(), sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const alice = user('11111111-1111-4111-8111-111111111111', 'alice@example.com', 'Alice');
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    await applySchema(sql); await getChat(alice,sql);
    await pg.exec('DROP TABLE relay.operations; DELETE FROM relay.schema_migrations; INSERT INTO relay.schema_migrations(version) VALUES(3);');
    await applySchema(sql); await applySchema(sql);
    assert.equal((await getChat(alice,sql)).user.name,'Alice');
    assert.equal((await pg.query('select * from relay.schema_migrations where version=5')).rows.length,1);
    const schema=await pg.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where oid='relay.operations'::regclass"); assert.equal(schema.rows[0].relrowsecurity,true);
    for(const role of ['anon','authenticated']) { await pg.exec(`SET ROLE ${role}`); await assert.rejects(pg.query('select * from relay.operations'),/permission denied/); await pg.exec('RESET ROLE'); }
  } finally { await pg.close(); }
});

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
    assert.equal((await pg.query<{ version: number }>('select version from relay.schema_migrations')).rows[0].version, 5);
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
    assert.deepEqual((await getAttachment(bob,messageId,0,sql)).bytes,png);
    assert.deepEqual((await getAttachment(bob,messageId,1,sql)).bytes,voice);
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
    for (const emoji of ['🇬🇷', '1️⃣', '👩🏽‍💻']) {
      const native = await mutateChat(bob, { type: 'react', messageId, emoji }, sql);
      assert.equal(native.state.messages[0].reactions.some(reaction => reaction.emoji === emoji && reaction.userIds.includes(bob.id)), true);
      const toggled = await mutateChat(bob, { type: 'react', messageId, emoji }, sql);
      assert.equal(toggled.state.messages[0].reactions.some(reaction => reaction.emoji === emoji), false);
    }
    for (const emoji of ['👍 ready', '👍👍', '🇬', '👍\n'])
      await assert.rejects(mutateChat(bob, { type: 'react', messageId, emoji }, sql), (error: unknown) => error instanceof ChatError && error.status === 400);
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

function uploadChunks(messageId: string, conversationId: string, bytes: Buffer, metadata = { name: 'photo.png', type: 'image/png' }, attachmentIndex = 0): UploadChunk[] {
  return Array.from({ length: Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES) }, (_, chunkIndex) => ({
    clientMessageId: messageId, conversationId, attachmentIndex, name: metadata.name, type: metadata.type, size: bytes.length,
    chunkIndex, totalChunks: Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES),
    data: bytes.subarray(chunkIndex * UPLOAD_CHUNK_BYTES, (chunkIndex + 1) * UPLOAD_CHUNK_BYTES).toString('base64'),
  }));
}

test('durable chunks commit three full-size files atomically and deduplicate a lost final acknowledgement', async () => {
  const pg = new PGlite(), sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const alice = user('11111111-1111-4111-8111-111111111111', 'alice@example.com', 'Alice');
  const bob = user('22222222-2222-4222-8222-222222222222', 'bob@example.com', 'Bob');
  try {
    await applySchema(sql);
    await getChat(alice, sql);
    const conversationId = (await mutateChat(alice, { type: 'create', name: 'Bob', kind: 'dm', emails: [bob.email] }, sql)).id!;
    await getChat(bob, sql);
    const messageId = crypto.randomUUID();
    const files = Array.from({ length: 3 }, (_, index) => {
      const bytes = Buffer.alloc(MAX_ATTACHMENT_BYTES, index + 1); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
      return { bytes, name: `photo-${index}.png`, type: 'image/png' };
    });
    for (let index = 0; index < files.length; index++) {
      const chunks = uploadChunks(messageId, conversationId, files[index].bytes, files[index], index);
      for (const chunk of chunks) {
        assert.ok(Buffer.byteLength(JSON.stringify(chunk)) < MAX_UPLOAD_BODY_BYTES);
        await stageUpload(alice, chunk, sql);
        await stageUpload(alice, chunk, sql); // Repeated chunk acknowledgements are immutable.
      }
    }
    assert.equal((await pg.query('select * from relay.uploads')).rows.length, 3);
    assert.equal((await getChat(bob, sql)).messages.length, 0, 'staging never appears as a message');
    const attachments = files.map((file, index) => ({ name: file.name, type: file.type, size: file.bytes.length, url: `upload:${messageId}:${index}` }));
    const action = { type: 'send', clientMessageId: messageId, conversationId, text: 'Three 5 MB files', attachments };
    const first = await mutateChat(alice, action, sql);
    assert.equal(first.id, messageId);
    assert.equal((await pg.query('select * from relay.uploads')).rows.length, 0, 'consumed in the same commit as the message');
    for (let index = 0; index < files.length; index++) {
      for (const chunk of uploadChunks(messageId, conversationId, files[index].bytes, files[index], index)) await stageUpload(alice, chunk, sql);
      assert.deepEqual((await getAttachment(bob, messageId, index, sql)).bytes, files[index].bytes);
    }
    const events = (await pg.query('select * from relay.events')).rows.length;
    await mutateChat(alice, action, sql);
    assert.equal((await getChat(bob, sql)).messages.length, 1);
    assert.equal((await pg.query('select * from relay.events')).rows.length, events);
    assert.equal((await pg.query('select * from relay.uploads')).rows.length, 0, 'retry after commit creates no staging rows');
    const changed = uploadChunks(messageId, conversationId, Buffer.from(files[0].bytes))[1];
    const altered = Buffer.from(changed.data, 'base64'); altered[0] ^= 1;
    await assert.rejects(stageUpload(alice, { ...changed, data: altered.toString('base64') }, sql), (error: unknown) => error instanceof ChatError && error.status === 409);
    const binary = await getAttachment(bob, messageId, 0, sql);
    const reader = attachmentResponse(binary.file, binary.bytes).body!.getReader();
    let streamed = 0, count = 0;
    while (true) { const part = await reader.read(); if (part.done) break; assert.ok(part.value.length <= 64 * 1024); streamed += part.value.length; count++; }
    assert.equal(streamed, MAX_ATTACHMENT_BYTES); assert.ok(count > 1, 'large responses are explicit streams');
  } finally { await pg.close(); }
});

test('chunk ownership, immutable metadata, expiry, and membership remain private across retries', async () => {
  const pg = new PGlite(), sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const alice = user('11111111-1111-4111-8111-111111111111', 'alice@example.com', 'Alice');
  const bob = user('22222222-2222-4222-8222-222222222222', 'bob@example.com', 'Bob');
  const outsider = user('33333333-3333-4333-8333-333333333333', 'outsider@example.com', 'Outsider');
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    await applySchema(sql); await getChat(alice, sql);
    const conversationId = (await mutateChat(alice, { type: 'create', name: 'Bob', kind: 'dm', emails: [bob.email] }, sql)).id!;
    await getChat(bob, sql);
    const bytes = Buffer.alloc(UPLOAD_CHUNK_BYTES + 17); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
    const messageId = crypto.randomUUID(), chunks = uploadChunks(messageId, conversationId, bytes);
    const action = { type: 'send', conversationId, clientMessageId: messageId, text: '', attachments: [{ name: 'photo.png', type: 'image/png', size: bytes.length, url: `upload:${messageId}:0` }] };
    await stageUpload(alice, chunks[0], sql);
    await assert.rejects(stageUpload(outsider, chunks[0], sql), (e: unknown) => e instanceof ChatError && e.status === 404);
    await assert.rejects(stageUpload(bob, chunks[0], sql), (e: unknown) => e instanceof ChatError && e.status === 409);
    await assert.rejects(mutateChat(bob, action, sql), /incomplete|expired/);
    await assert.rejects(stageUpload(alice, { ...chunks[0], name: 'different.png' }, sql), (e: unknown) => e instanceof ChatError && e.status === 409);
    const changed = Buffer.from(chunks[0].data, 'base64'); changed[20] = 17;
    await assert.rejects(stageUpload(alice, { ...chunks[0], data: changed.toString('base64') }, sql), (e: unknown) => e instanceof ChatError && e.status === 409);
    await assert.rejects(mutateChat(alice, action, sql), /chunk/);
    assert.equal((await pg.query('select * from relay.uploads')).rows.length, 1, 'incomplete finalization rolls back consumption');
    await pg.query("update relay.uploads set expires_at=now()-interval '1 second' where message_id=$1", [messageId]);
    await assert.rejects(mutateChat(alice, action, sql), /expired/);
    await stageUpload(alice, chunks[0], sql); await stageUpload(alice, chunks[1], sql);
    await assert.rejects(mutateChat(alice, { ...action, attachments: [{ ...action.attachments[0], url: `upload:${messageId}:1` }] }, sql), /belong/);
    const bad = { ...action, parentId: crypto.randomUUID() };
    await assert.rejects(mutateChat(alice, bad, sql), /no longer available/);
    assert.equal((await pg.query('select * from relay.uploads')).rows.length, 1, 'later validation failure also rolls back consumption');
    await mutateChat(alice, action, sql);
    await assert.rejects(mutateChat(bob, action, sql), (e: unknown) => e instanceof ChatError && e.status === 409);
    await mutateChat(alice, { type: 'delete', messageId }, sql);
    await assert.rejects(stageUpload(alice, chunks[0], sql), (e: unknown) => e instanceof ChatError && e.status === 409);
    await assert.rejects(getAttachment(bob, messageId, 0, sql), (e: unknown) => e instanceof ChatError && e.status === 404);
    const bobChunk = { ...chunks[0], clientMessageId: crypto.randomUUID() };
    await stageUpload(bob, bobChunk, sql);
    await mutateChat(bob, { type: 'leave', conversationId }, sql);
    assert.equal((await pg.query('select * from relay.uploads where owner_id=$1', [bob.id])).rows.length, 0);
    await assert.rejects(stageUpload(bob, bobChunk, sql), (e: unknown) => e instanceof ChatError && e.status === 404);
    for (const role of ['anon', 'authenticated']) {
      await pg.exec(`SET ROLE ${role}`); await assert.rejects(pg.query('SELECT * FROM relay.uploads'), /permission denied/); await pg.exec('RESET ROLE');
    }
  } finally { await pg.close(); }
});

test('staging reservations stay bounded and migration upgrades preserve existing chat data', async () => {
  const pg = new PGlite(), sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const alice = user('11111111-1111-4111-8111-111111111111', 'alice@example.com', 'Alice');
  try {
    await applySchema(sql); await getChat(alice, sql);
    const conversationId = (await mutateChat(alice, { type: 'create', name: 'Private', kind: 'space', emails: [] }, sql)).id!;
    const saved = await mutateChat(alice, { type: 'send', conversationId, text: 'Preserve this message' }, sql);
    await pg.exec('DROP TABLE relay.uploads; DELETE FROM relay.schema_migrations; INSERT INTO relay.schema_migrations(version) VALUES(2);');
    await applySchema(sql); await applySchema(sql);
    assert.equal((await getChat(alice, sql)).messages[0].id, saved.id);
    assert.deepEqual((await pg.query<{ version: number }>('select version from relay.schema_migrations order by version')).rows.map(row => row.version), [2, 5]);
    const bytes = Buffer.alloc(MAX_ATTACHMENT_BYTES); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
    for (let index = 0; index < 4; index++) await stageUpload(alice, uploadChunks(crypto.randomUUID(), conversationId, bytes)[0], sql);
    await assert.rejects(stageUpload(alice, uploadChunks(crypto.randomUUID(), conversationId, bytes)[0], sql), (e: unknown) => e instanceof ChatError && e.status === 429);
    assert.equal((await pg.query<{ count: number; bytes: number }>('select count(*)::integer as count,sum(size)::integer as bytes from relay.uploads')).rows[0].bytes, 20 * 1024 * 1024);
    await pg.exec("update relay.uploads set expires_at=now()-interval '1 second'");
    await stageUpload(alice, uploadChunks(crypto.randomUUID(), conversationId, bytes)[0], sql);
    assert.equal((await pg.query('select * from relay.uploads')).rows.length, 1, 'expired reservations are deleted during the next valid upload');
    await pg.exec('delete from relay.uploads');
    const tiny = Buffer.from('safe text');
    for (let index = 0; index < 6; index++) await stageUpload(alice, uploadChunks(crypto.randomUUID(), conversationId, tiny, { name: 'tiny.txt', type: 'text/plain' })[0], sql);
    await assert.rejects(stageUpload(alice, uploadChunks(crypto.randomUUID(), conversationId, tiny, { name: 'tiny.txt', type: 'text/plain' })[0], sql), (e: unknown) => e instanceof ChatError && e.status === 429);
  } finally { await pg.close(); }
});

test('stable client message IDs deduplicate lost acknowledgements and reject foreign or changed payloads', async () => {
  const pg = new PGlite();
  const sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const alice = user('11111111-1111-4111-8111-111111111111', 'alice@example.com', 'Alice');
  const bob = user('22222222-2222-4222-8222-222222222222', 'bob@example.com', 'Bob');
  try {
    await applySchema(sql);
    await getChat(alice, sql);
    const conversation = await mutateChat(alice, { type: 'create', name: 'Bob', kind: 'dm', emails: [bob.email] }, sql);
    await getChat(bob, sql);
    const audio = Buffer.from([0x1a,0x45,0xdf,0xa3,0]);
    const action = { type: 'send', conversationId: conversation.id!, text: 'Hello friend', clientMessageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', attachments: [{ name: 'voice.webm', type: 'audio/webm', size: audio.length, url: `data:audio/webm;base64,${audio.toString('base64')}` }] };
    const committed = await mutateChat(alice, action, sql); // Simulate losing this acknowledgement.
    const eventCount = (await pg.query('select * from relay.events')).rows.length;
    const retry = await mutateChat(alice, action, sql);
    assert.equal(retry.id, committed.id);
    assert.equal(retry.state.messages.length, 1);
    assert.equal((await getChat(bob, sql)).messages.length, 1);
    assert.equal((await pg.query('select * from relay.events')).rows.length, eventCount, 'deduplicated retries emit no duplicate realtime events');
    const upper = await mutateChat(alice, { ...action, clientMessageId: action.clientMessageId.toUpperCase(), conversationId: action.conversationId.toUpperCase() }, sql);
    assert.equal(upper.id, committed.id);
    await assert.rejects(mutateChat(bob, action, sql), (e: unknown) => e instanceof ChatError && e.status === 409);
    await assert.rejects(mutateChat(alice, { ...action, text: 'Changed payload' }, sql), (e: unknown) => e instanceof ChatError && e.status === 409);
    await assert.rejects(mutateChat(alice, { ...action, attachments: [] }, sql), (e: unknown) => e instanceof ChatError && e.status === 409);
    await assert.rejects(mutateChat(alice, { ...action, clientMessageId: 'invalid' }, sql), (e: unknown) => e instanceof ChatError && e.status === 400);
    const other = await mutateChat(alice, { type: 'create', name: 'Private space', kind: 'space', emails: [] }, sql);
    await assert.rejects(mutateChat(alice, { ...action, conversationId: other.id }, sql), (e: unknown) => e instanceof ChatError && e.status === 409);
    const concurrent = { ...action, clientMessageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    const [first, second] = await Promise.all([mutateChat(alice, concurrent, sql), mutateChat(alice, concurrent, sql)]);
    assert.equal(first.id, second.id);
    assert.equal((await getChat(alice, sql)).messages.length, 2);
    const legacy = { type: 'send', conversationId: action.conversationId, text: 'Legacy client' };
    const legacyOne = await mutateChat(alice, legacy, sql);
    const legacyTwo = await mutateChat(alice, legacy, sql);
    assert.notEqual(legacyOne.id, legacyTwo.id);
    assert.equal((await getChat(alice, sql)).messages.length, 4);
  } finally { await pg.close(); }
});

test('full-size media stays private, downloads for both members, and polling only returns metadata', async () => {
  const pg = new PGlite();
  const sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const alice = user('11111111-1111-4111-8111-111111111111', 'alice@example.com', 'Alice');
  const bob = user('22222222-2222-4222-8222-222222222222', 'bob@example.com', 'Bob');
  const outsider = user('33333333-3333-4333-8333-333333333333', 'outsider@example.com', 'Outsider');
  const file = (name: string, type: string, signature: Buffer) => {
    const bytes = Buffer.alloc(MAX_ATTACHMENT_BYTES);
    signature.copy(bytes);
    return { name, type, size: bytes.length, url: `data:${type};base64,${bytes.toString('base64')}` };
  };
  try {
    await applySchema(sql);
    await getChat(alice, sql);
    const conversation = await mutateChat(alice, { type: 'create', name: 'Bob', kind: 'dm', emails: [bob.email] }, sql);
    await getChat(bob, sql);
    const png = file('full-size.png', 'image/png', Buffer.from([137,80,78,71,13,10,26,10]));
    const first = await mutateChat(alice, { type: 'send', conversationId: conversation.id, text: 'One full-size file', attachments: [png] }, sql);
    const single = (await getChat(bob, sql)).messages.find(message => message.id === first.id)!;
    assert.equal(single.attachments[0].size, MAX_ATTACHMENT_BYTES);
    assert.equal(single.attachments[0].url, `/api/attachments?messageId=${first.id}&index=0`);
    const binary = await getAttachment(bob, first.id, 0, sql);
    assert.equal(binary.bytes.length, MAX_ATTACHMENT_BYTES);
    assert.deepEqual(binary.bytes.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
    const response = attachmentResponse(binary.file, binary.bytes);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('content-length'), String(MAX_ATTACHMENT_BYTES));
    assert.match(response.headers.get('cache-control')!, /private, no-store/);
    assert.equal(response.headers.get('vary'), 'Authorization');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await response.arrayBuffer()).byteLength, MAX_ATTACHMENT_BYTES);
    const files = [png, file('full-size.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n')), file('full-size.m4a', 'audio/mp4', Buffer.from([0,0,0,16,102,116,121,112,109,52,97,32]))];
    const bundle = await mutateChat(alice, { type: 'send', conversationId: conversation.id, text: 'Three full-size files', attachments: files }, sql);
    assert.equal(bundle.state.messages.find(message => message.id === bundle.id)?.attachments.length, 3);
    const newest = await mutateChat(bob, { type: 'send', conversationId: conversation.id, text: 'Received them' }, sql);
    const state = await getChat(alice, sql);
    assert.deepEqual(state.messages.map(message => message.id), [first.id, bundle.id, newest.id]);
    assert.deepEqual(state.messages[1].attachments.map(({ name, type, size }) => ({ name, type, size })), files.map(({ name, type, size }) => ({ name, type, size })));
    for (let index = 0; index < files.length; index++) {
      assert.equal(state.messages[1].attachments[index].url, `/api/attachments?messageId=${bundle.id}&index=${index}`);
      assert.equal((await getAttachment(bob, bundle.id, String(index), sql)).bytes.length, MAX_ATTACHMENT_BYTES);
    }
    assert.equal((await getChat(bob, sql)).messages[1].attachments.every(attachment => attachment.size === MAX_ATTACHMENT_BYTES), true);
    const payload = state.messages.reduce((sum, message) => sum + Buffer.byteLength(JSON.stringify(message.attachments)) + Buffer.byteLength(message.text) + 300, 0);
    assert.equal(payload < MAX_HISTORY_PAYLOAD_BYTES, true);
    assert.equal(JSON.stringify(state).length < 10000, true, 'four full-size media files must not inflate polling responses');
    assert.equal(JSON.stringify(state).includes('base64,'), false);
    assert.equal((await getChat(outsider, sql)).messages.length, 0, 'larger files never weaken membership isolation');
    await assert.rejects(getAttachment(outsider, bundle.id, 0, sql), (e: unknown) => e instanceof ChatError && e.status === 404);
    for (const index of [-1, 3, 1.2, '0;SELECT', null]) await assert.rejects(getAttachment(alice, bundle.id, index, sql), (e: unknown) => e instanceof ChatError && e.status === 404);
    await assert.rejects(getAttachment(alice, first.id, 2, sql), (e: unknown) => e instanceof ChatError && e.status === 404);
    await mutateChat(alice, { type: 'delete', messageId: first.id }, sql);
    await assert.rejects(getAttachment(alice, first.id, 0, sql), (e: unknown) => e instanceof ChatError && e.status === 404);
    await mutateChat(bob, { type: 'leave', conversationId: conversation.id }, sql);
    await assert.rejects(getAttachment(bob, bundle.id, 0, sql), (e: unknown) => e instanceof ChatError && e.status === 404);
    assert.equal((await getAttachment(alice, bundle.id, 0, sql)).bytes.length, MAX_ATTACHMENT_BYTES);
  } finally { await pg.close(); }
});

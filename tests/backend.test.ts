import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoState, applyDemoAction } from '../src/lib/demo';
import { publicConfig, readActionBody, authenticatedUser, ChatError, SCHEMA, validateAttachments } from '../src/lib/server';
import type { ChatAction, ChatState } from '../src/lib/types';

const anonKey = `e30.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.test-signature`;
function configure() {
  process.env.SUPABASE_URL = 'https://auth.example.com';
  process.env.SUPABASE_ANON_KEY = anonKey;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

test('public config exposes only public settings and rejects insecure/misassigned keys', () => {
  configure();
  process.env.DATABASE_URL = 'postgres://private:secret@private.example/db';
  assert.deepEqual(publicConfig(), { supabaseUrl: 'https://auth.example.com', supabaseAnonKey: anonKey, databaseConfigured: true });
  assert.equal(JSON.stringify(publicConfig()).includes('secret'), false);
  process.env.SUPABASE_URL = 'http://auth.example.com';
  assert.equal(publicConfig().supabaseUrl, '');
  assert.equal(publicConfig().supabaseAnonKey, '');
  process.env.SUPABASE_URL = 'https://user:password@auth.example.com';
  assert.equal(publicConfig().supabaseUrl, '');
  process.env.SUPABASE_URL = 'https://auth.example.com?secret=no';
  assert.equal(publicConfig().supabaseUrl, '');
  configure();
  process.env.SUPABASE_ANON_KEY = `e30.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.private`;
  assert.equal(publicConfig().supabaseAnonKey, '');
  process.env.SUPABASE_ANON_KEY = 'sb_secret_private';
  assert.equal(publicConfig().supabaseAnonKey, '');
  process.env.SUPABASE_ANON_KEY = 'sb_publishable_demo';
  assert.equal(publicConfig().supabaseAnonKey, 'sb_publishable_demo');
  delete process.env.DATABASE_URL;
});

test('JSON reader accepts ordinary actions, rejects invalid content, and bounds streamed requests', async () => {
  const request = (body: string, headers: Record<string, string> = {}) => new Request('https://chat.example.com/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  assert.deepEqual(await readActionBody(request('{"type":"read","conversationId":"test"}')), { type: 'read', conversationId: 'test' });
  await assert.rejects(readActionBody(request('{')), (e: unknown) => e instanceof ChatError && e.status === 400);
  await assert.rejects(readActionBody(request('{}', { 'Content-Type': 'text/plain' })), (e: unknown) => e instanceof ChatError && e.status === 415);
  await assert.rejects(readActionBody(request('{}', { 'Content-Length': '4300001' })), (e: unknown) => e instanceof ChatError && e.status === 413);
  await assert.rejects(readActionBody(request(' '.repeat(4_300_001))), (e: unknown) => e instanceof ChatError && e.status === 413);
});

test('authentication rejects absent bearer and uses provider-verified identity/email', async () => {
  configure();
  await assert.rejects(authenticatedUser(new Request('https://chat.example.com/api/chat')), (e: unknown) => e instanceof ChatError && e.status === 401);
  const originalFetch = globalThis.fetch;
  let confirmed = true;
  let called = false;
  const token = 'x'.repeat(40);
  globalThis.fetch = async (input, init) => {
    called = true;
    assert.equal(String(input).startsWith('https://auth.example.com/auth/v1/user'), true);
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${token}`);
    return Response.json({ id: 'verified-account-id', email: 'friend@example.com', email_confirmed_at: confirmed ? '2026-10-05T00:00:00Z' : null, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-05T00:00:00Z' });
  };
  const request = new Request('https://chat.example.com/api/chat', { headers: { Authorization: `Bearer ${token}` } });
  try {
    const user = await authenticatedUser(request);
    assert.equal(user.id, 'verified-account-id');
    assert.equal(user.email, 'friend@example.com');
    assert.equal(called, true);
    confirmed = false;
    await assert.rejects(authenticatedUser(request), (e: unknown) => e instanceof ChatError && e.status === 403);
  } finally { globalThis.fetch = originalFetch; }
});

test('demo conversations implement message, thread, reaction, star, profile, and leaving interactions', () => {
  let state = createDemoState();
  const mutate = (action: ChatAction) => { const result = applyDemoAction(state, action); state = result.state; return result.id; };
  const original: ChatState = structuredClone(state);
  const conversationId = mutate({ type: 'create', name: 'Friends', kind: 'group', emails: ['friend@example.com'] })!;
  const conversation = () => state.conversations.find(c => c.id === conversationId)!;
  assert.equal(conversation().members.length, 2);
  const messageId = mutate({ type: 'send', conversationId, text: 'Hello, friend!' })!;
  mutate({ type: 'react', messageId, emoji: '👍' });
  assert.deepEqual(state.messages.at(-1)?.reactions, [{ emoji: '👍', userIds: [state.user.id] }]);
  mutate({ type: 'react', messageId, emoji: '👍' });
  assert.equal(state.messages.at(-1)?.reactions.length, 0);
  mutate({ type: 'star', messageId });
  assert.equal(state.messages.at(-1)?.starred, true);
  mutate({ type: 'edit', messageId, text: 'Hello again!' });
  assert.equal(state.messages.at(-1)?.edited, true);
  const replyId = mutate({ type: 'send', conversationId, text: 'A thread reply', parentId: messageId });
  assert.equal(state.messages.find(m => m.id === replyId)?.parentId, messageId);
  mutate({ type: 'read', conversationId, unread: true });
  assert.equal(conversation().unread, 1);
  mutate({ type: 'read', conversationId });
  assert.equal(conversation().unread, 0);
  mutate({ type: 'conversation', conversationId, pinned: true, muted: true, section: 'My people', name: 'Best friends' });
  assert.equal(conversation().name, 'Best friends');
  assert.equal(conversation().pinned, true);
  assert.equal(conversation().muted, true);
  assert.equal(conversation().section, 'My people');
  mutate({ type: 'invite', conversationId, emails: ['another@example.com'] });
  assert.equal(conversation().members.length, 3);
  mutate({ type: 'profile', name: 'New Name', status: 'Away' });
  assert.equal(state.messages.find(m => m.id === messageId)?.author.name, 'New Name');
  mutate({ type: 'delete', messageId });
  const deleted = state.messages.find(m => m.id === messageId)!;
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.text, '');
  assert.deepEqual(deleted.attachments, []);
  mutate({ type: 'leave', conversationId });
  assert.equal(state.conversations.some(c => c.id === conversationId), false);
  assert.equal(state.messages.some(m => m.conversationId === conversationId), false);
  assert.equal(original.messages.find(m => m.id === 'demo-message-1')?.text.includes('Good morning'), true);
});

test('demo rejects foreign edits, cross-conversation threads, invalid invitations and unsafe attachment URLs', () => {
  const state = createDemoState();
  assert.throws(() => applyDemoAction(state, { type: 'edit', messageId: 'demo-message-1', text: 'Changed' }), /your own/);
  assert.throws(() => applyDemoAction(state, { type: 'delete', messageId: 'demo-message-1' }), /your own/);
  assert.throws(() => applyDemoAction(state, { type: 'send', conversationId: 'demo-maya-dm', text: 'Wrong thread', parentId: 'demo-message-1' }), /thread/);
  assert.throws(() => applyDemoAction(state, { type: 'create', name: 'Bad', kind: 'group', emails: ['not an email'] }), /email/);
  assert.throws(() => applyDemoAction(state, { type: 'invite', conversationId: 'demo-maya-dm', emails: ['friend@example.com'] }), /group/);
  assert.throws(() => applyDemoAction(state, { type: 'send', conversationId: 'demo-design', text: '', attachments: [{ name: 'bad.svg', type: 'image/svg+xml', url: 'javascript:alert(1)', size: 100 }] }), /Attach/);
  assert.throws(() => applyDemoAction(state, { type: 'send', conversationId: 'demo-design', text: 'x'.repeat(6001) }), /6000/);
  const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0]).toString('base64');
  const sent = applyDemoAction(state, { type: 'send', conversationId: 'demo-design', text: '', attachments: [{ name: 'voice.webm', type: 'audio/webm', url: `data:audio/webm;base64,${audio}`, size: 5 }] });
  assert.equal(sent.state.messages.at(-1)?.attachments[0].type, 'audio/webm');
});

test('schema keeps chat tables private and enables RLS for every table', () => {
  assert.match(SCHEMA, /CREATE SCHEMA IF NOT EXISTS relay/);
  assert.match(SCHEMA, /REVOKE ALL ON SCHEMA relay FROM PUBLIC/);
  for (const name of ['profiles','conversations','participants','invites','messages','reactions','stars','events','schema_migrations']) {
    assert.match(SCHEMA, new RegExp(`CREATE TABLE IF NOT EXISTS relay\\.${name}`));
    assert.match(SCHEMA, new RegExp(`ALTER TABLE relay\\.${name} ENABLE ROW LEVEL SECURITY`));
  }
});

test('server accepts safe media signatures and rejects active content, spoofing, mismatched sizes, and excessive files', () => {
  const file = (type: string, bytes: Buffer) => ({ name: 'attachment', type, size: bytes.length, url: `data:${type};base64,${bytes.toString('base64')}` });
  const png = file('image/png', Buffer.from([137,80,78,71,13,10,26,10,0]));
  assert.equal(validateAttachments([png])[0].type, 'image/png');
  for (const [type, bytes] of [
    ['audio/webm', Buffer.from([0x1a,0x45,0xdf,0xa3,0])],
    ['audio/mp4', Buffer.from([0,0,0,16,102,116,121,112,0])],
    ['audio/ogg', Buffer.from('OggS\0')],
  ] as const) assert.equal(validateAttachments([file(type, bytes)])[0].type, type);
  assert.throws(() => validateAttachments([{ ...png, type: 'image/svg+xml', url: 'data:image/svg+xml;base64,PHN2Zz4=' }]), /Use an image/);
  assert.throws(() => validateAttachments([{ ...png, url: 'javascript:alert(1)' }]), /file data/);
  assert.throws(() => validateAttachments([file('image/png', Buffer.from('<script>alert(1)</script>'))]), /content does not match/);
  assert.throws(() => validateAttachments([file('audio/webm', Buffer.from('<script>alert(1)</script>'))]), /content does not match/);
  assert.throws(() => validateAttachments([{ ...png, size: 1 }]), /under 1 MB/);
  assert.throws(() => validateAttachments([png,png,png,png]), /up to 3/);
  assert.throws(() => validateAttachments([file('text/plain', Buffer.alloc(1_048_577))]), /under 1 MB/);
});

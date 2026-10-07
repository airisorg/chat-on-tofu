import assert from 'node:assert/strict';
import { test } from 'node:test';
import { committedSend, PendingSendIds } from '../src/lib/use-chat';
import type { ChatState, SendDraft } from '../src/lib/types';

const conversationId = '11111111-1111-4111-8111-111111111111';
const parentId = '22222222-2222-4222-8222-222222222222';
const draft: SendDraft = { type: 'send', conversationId, text: 'Lifecycle fixture text', attachments: [] };
const key = 'relay-chat-send-ids-v1:account-a';

function memoryStorage() {
  const values = new Map<string, string>();
  let rejectWrites = false;
  return {
    values,
    rejectWrites(value: boolean) { rejectWrites = value; },
    getItem: (name: string) => values.get(name) ?? null,
    setItem(name: string, value: string) {
      if (rejectWrites) throw new Error('Synthetic storage unavailable');
      values.set(name, value);
    },
    removeItem(name: string) {
      if (rejectWrites) throw new Error('Synthetic storage unavailable');
      values.delete(name);
    },
  };
}

test('unconfirmed send identity survives close without creating an identity during inspection', async () => {
  const storage = memoryStorage();
  const first = new PendingSendIds(storage);
  first.bindVerifiedIdentity('account-a');
  assert.equal(await first.inspect(draft), null);
  assert.equal(storage.values.has(key), false);
  const prepared = await first.prepare(draft);
  first.clear();
  const reopened = new PendingSendIds(storage);
  reopened.bindVerifiedIdentity('account-a');
  const recovered = await reopened.inspect(draft);
  assert.equal(recovered?.id, prepared.action.clientMessageId);
  assert.equal(recovered?.confirmed, false);
  assert.equal(recovered?.durable, true);
  assert.equal((await reopened.prepare(draft)).action.clientMessageId, prepared.action.clientMessageId);
});

test('accepted ACK remains durable until the exact draft is consumed', async () => {
  const storage = memoryStorage();
  const first = new PendingSendIds(storage);
  first.bindVerifiedIdentity('account-a');
  const prepared = await first.prepare(draft);
  first.confirm(prepared.fingerprint, prepared.action.clientMessageId);
  first.clear();
  const reopened = new PendingSendIds(storage);
  reopened.bindVerifiedIdentity('account-a');
  const recovered = await reopened.inspect(draft);
  assert.equal(recovered?.confirmed, true);
  assert.equal(recovered?.id, prepared.action.clientMessageId);
  await reopened.reconcile([draft], new Set());
  assert.equal((await reopened.inspect(draft))?.id, prepared.action.clientMessageId);
  reopened.acknowledge(prepared.fingerprint, crypto.randomUUID());
  assert.equal((await reopened.inspect(draft))?.confirmed, true);
  reopened.acknowledge(prepared.fingerprint, prepared.action.clientMessageId);
  assert.equal(await reopened.inspect(draft), null);
  assert.notEqual((await reopened.prepare(draft)).action.clientMessageId, prepared.action.clientMessageId);
});

test('crash after durable draft clear retires confirmed receipt before an intentional identical send', async () => {
  const storage = memoryStorage();
  const first = new PendingSendIds(storage);
  first.bindVerifiedIdentity('account-a');
  const prepared = await first.prepare(draft);
  first.confirm(prepared.fingerprint, prepared.action.clientMessageId);
  first.clear();
  const reopened = new PendingSendIds(storage);
  reopened.bindVerifiedIdentity('account-a');
  await reopened.reconcile([], new Set());
  assert.equal(await reopened.inspect(draft), null);
  assert.notEqual((await reopened.prepare(draft)).action.clientMessageId, prepared.action.clientMessageId);
});

test('authoritative own UUID retires only an absent committed receipt and preserves unresolved drafts', async () => {
  const storage = memoryStorage();
  const ids = new PendingSendIds(storage);
  ids.bindVerifiedIdentity('account-a');
  const committed = await ids.prepare(draft);
  const otherDraft = { ...draft, text: 'Another unresolved send' };
  const unresolved = await ids.prepare(otherDraft);
  await ids.reconcile([], new Set([committed.action.clientMessageId]));
  assert.equal(await ids.inspect(draft), null);
  assert.equal((await ids.inspect(otherDraft))?.id, unresolved.action.clientMessageId);
  await ids.reconcile([otherDraft], new Set([unresolved.action.clientMessageId]));
  assert.equal((await ids.inspect(otherDraft))?.id, unresolved.action.clientMessageId);
});

test('version1 pending pairs migrate without inventing confirmation or persisting private contents', async () => {
  const storage = memoryStorage();
  const seed = new PendingSendIds(storage);
  seed.bindVerifiedIdentity('account-a');
  const prepared = await seed.prepare(draft);
  storage.values.set(key, JSON.stringify({ version: 1, entries: [[prepared.fingerprint, prepared.action.clientMessageId]] }));
  const recovered = new PendingSendIds(storage);
  recovered.bindVerifiedIdentity('account-a');
  assert.equal((await recovered.inspect(draft))?.confirmed, false);
  assert.equal((await recovered.inspect(draft))?.id, prepared.action.clientMessageId);
  const saved = JSON.parse(storage.values.get(key)!);
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.entries, [[prepared.fingerprint, prepared.action.clientMessageId, false]]);
  assert.equal(storage.values.get(key)!.includes(draft.text), false);
  assert.equal(storage.values.get(key)!.includes(conversationId), false);
});

test('edited text, media, conversation and thread never inspect as the original draft', async () => {
  const ids = new PendingSendIds();
  const prepared = await ids.prepare(draft);
  for (const changed of [
    { ...draft, text: 'A deliberate edit' },
    { ...draft, conversationId: parentId },
    { ...draft, parentId },
    { ...draft, attachments: [{ name: 'fixture.txt', type: 'text/plain', size: 1, url: 'data:text/plain;base64,QQ==' }] },
  ]) assert.equal(await ids.inspect(changed), null);
  assert.equal((await ids.inspect({ ...draft, text: ` ${draft.text} ` }))?.id, prepared.action.clientMessageId);
});

test('authoritative confirmation requires current owner, exact UUID, conversation and parent', () => {
  const user = { id: 'account-a', name: 'Fixture owner', email: 'owner@example.com' };
  const id = crypto.randomUUID();
  const state: ChatState = { user, conversations: [], messages: [{ id, conversationId, author: user, text: 'Subsequently edited text', createdAt: new Date().toISOString(), attachments: [], reactions: [] }] };
  assert.equal(committedSend(state, draft, id), true);
  assert.equal(committedSend(state, { ...draft, parentId }, id), false);
  assert.equal(committedSend(state, { ...draft, conversationId: parentId }, id), false);
  assert.equal(committedSend(state, draft, crypto.randomUUID()), false);
  assert.equal(committedSend({ ...state, user: { ...user, id: 'account-b' } }, draft, id), false);
  assert.equal(committedSend({ ...state, messages: [{ ...state.messages[0], parentId }] }, draft, id), false);
});

test('failed first UUID write exposes memory-only recovery without claiming reload durability', async () => {
  const storage = memoryStorage();
  const ids = new PendingSendIds(storage);
  ids.bindVerifiedIdentity('account-a');
  storage.rejectWrites(true);
  const prepared = await ids.prepare(draft);
  assert.equal((await ids.inspect(draft))?.durable, false);
  assert.equal((await ids.prepare(draft)).action.clientMessageId, prepared.action.clientMessageId);
  ids.confirm(prepared.fingerprint, prepared.action.clientMessageId);
  assert.equal((await ids.inspect(draft))?.confirmed, true);
  assert.equal((await ids.inspect(draft))?.durable, false);
  const reopened = new PendingSendIds(storage);
  reopened.bindVerifiedIdentity('account-a');
  assert.equal(await reopened.inspect(draft), null);
});

test('failed confirmation write keeps the previously durable UUID for authoritative reload recovery', async () => {
  const storage = memoryStorage();
  const ids = new PendingSendIds(storage);
  ids.bindVerifiedIdentity('account-a');
  const prepared = await ids.prepare(draft);
  storage.rejectWrites(true);
  ids.confirm(prepared.fingerprint, prepared.action.clientMessageId);
  assert.equal((await ids.inspect(draft))?.durable, true);
  const reopened = new PendingSendIds(storage);
  reopened.bindVerifiedIdentity('account-a');
  assert.equal((await reopened.inspect(draft))?.id, prepared.action.clientMessageId);
  assert.equal((await reopened.inspect(draft))?.confirmed, false);
});

test('readable legacy and confirmed receipts restore even when all storage writes are blocked', async () => {
  for (const version of [1, 2]) {
    const storage = memoryStorage();
    const seed = new PendingSendIds(storage);
    seed.bindVerifiedIdentity('account-a');
    const prepared = await seed.prepare(draft);
    storage.values.set(key, JSON.stringify({ version, entries: [version === 1
      ? [prepared.fingerprint, prepared.action.clientMessageId]
      : [prepared.fingerprint, prepared.action.clientMessageId, true]] }));
    storage.values.set('relay-chat-send-ids-last-identity-v1', 'previous-account');
    storage.rejectWrites(true);
    const reopened = new PendingSendIds(storage);
    reopened.bindVerifiedIdentity('account-a');
    const recovered = await reopened.inspect(draft);
    assert.equal(recovered?.id, prepared.action.clientMessageId);
    assert.equal(recovered?.confirmed, version === 2);
    assert.equal(recovered?.durable, true);
  }
});

test('capacity preserves existing unresolved identities through confirmation and reload', async () => {
  const storage = memoryStorage();
  const ids = new PendingSendIds(storage);
  ids.bindVerifiedIdentity('account-a');
  const first = await ids.prepare(draft);
  for (let i = 1; i < 64; i++) await ids.prepare({ ...draft, text: `${draft.text} ${i}` });
  ids.confirm(first.fingerprint, first.action.clientMessageId);
  const reopened = new PendingSendIds(storage);
  reopened.bindVerifiedIdentity('account-a');
  await assert.rejects(reopened.prepare({ ...draft, text: 'New intent at capacity' }), /Too many messages/);
  assert.equal((await reopened.prepare(draft)).action.clientMessageId, first.action.clientMessageId);
  await reopened.reconcile([], new Set());
  assert.notEqual((await reopened.prepare(draft)).action.clientMessageId, first.action.clientMessageId);
});

test('account changes cancel asynchronous inspection and reconciliation without exposing former IDs', async () => {
  const storage = memoryStorage();
  const ids = new PendingSendIds(storage);
  ids.bindVerifiedIdentity('account-a');
  const prepared = await ids.prepare(draft);
  const inspection = ids.inspect(draft);
  ids.bindVerifiedIdentity('account-b');
  await assert.rejects(inspection, /account changed/);
  assert.equal(await ids.inspect(draft), null);
  assert.equal(storage.values.has(key), false);
  const other = await ids.prepare(draft);
  assert.notEqual(other.action.clientMessageId, prepared.action.clientMessageId);
  const reconciliation = ids.reconcile([], new Set([other.action.clientMessageId]));
  ids.clear(true);
  await assert.rejects(reconciliation, /account changed/);
});

test('exact prepared and inspected objects have synchronous handles scoped to account revision', async () => {
  const storage = memoryStorage();
  const ids = new PendingSendIds(storage);
  ids.bindVerifiedIdentity('account-a');
  const prepared = await ids.prepare(draft);
  ids.confirm(prepared.fingerprint, prepared.action.clientMessageId);
  const known = ids.known(draft);
  assert.equal(known?.id, prepared.action.clientMessageId);
  assert.equal(known?.confirmed, true);
  assert.equal(ids.known({ ...draft }), null);
  ids.acknowledge(known!.fingerprint, known!.id);
  assert.equal(ids.known(draft), null);
  assert.equal(storage.values.has(key), false);

  const replacement = { ...draft };
  await ids.prepare(replacement);
  ids.clear();
  ids.bindVerifiedIdentity('account-a');
  assert.equal(ids.known(replacement), null);
  const recovered = await ids.inspect(replacement);
  assert.equal(ids.known(replacement)?.id, recovered?.id);
  ids.bindVerifiedIdentity('account-b');
  assert.equal(ids.known(replacement), null);
});

test('text-only quota restoration preserves the full-media confirmed UUID for repicking its original file', async () => {
  const storage = memoryStorage();
  const ids = new PendingSendIds(storage);
  ids.bindVerifiedIdentity('account-a');
  const withMedia: SendDraft = { ...draft, attachments: [{ name: 'fixture.txt', type: 'text/plain', size: 1, url: 'data:text/plain;base64,QQ==' }] };
  const sent = await ids.prepare(withMedia);
  ids.confirm(sent.fingerprint, sent.action.clientMessageId);
  ids.clear();
  const reopened = new PendingSendIds(storage);
  reopened.bindVerifiedIdentity('account-a');
  // Quota fallback saved this text but omitted the attachment. Its fingerprint
  // cannot prove that the full-media receipt is an unrelated intentional send.
  await reopened.reconcile([{ ...withMedia, attachments: [] }], new Set([sent.action.clientMessageId]));
  const repicked = await reopened.prepare(withMedia);
  assert.equal(repicked.action.clientMessageId, sent.action.clientMessageId);
  assert.equal((await reopened.inspect(withMedia))?.confirmed, true);
});

test('explicit partial restoration retains a media-only receipt despite an empty saved payload', async () => {
  const storage = memoryStorage();
  const ids = new PendingSendIds(storage);
  ids.bindVerifiedIdentity('account-a');
  const mediaOnly: SendDraft = { ...draft, text: '', attachments: [{ name: 'fixture.txt', type: 'text/plain', size: 1, url: 'data:text/plain;base64,QQ==' }] };
  const sent = await ids.prepare(mediaOnly);
  ids.confirm(sent.fingerprint, sent.action.clientMessageId);
  await ids.reconcile([], new Set([sent.action.clientMessageId]), true);
  assert.equal((await ids.inspect(mediaOnly))?.id, sent.action.clientMessageId);
  await ids.reconcile([], new Set([sent.action.clientMessageId]), false);
  assert.equal(await ids.inspect(mediaOnly), null);
});

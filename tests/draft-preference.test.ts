import test from 'node:test';
import assert from 'node:assert/strict';
import {
  draftSavingKey,
  readDraftSaving,
  savedDraftsKey,
  writeDraftSaving,
} from '../src/lib/draft-preference';

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test('draft saving defaults on, remembers an explicit opt-out and isolates account choices', () => {
  const store = storage();
  assert.equal(readDraftSaving('first', store), true);
  assert.deepEqual(writeDraftSaving('first', false, store), {
    preferenceSaved: true,
    savedDraftsRemoved: true,
  });
  assert.equal(readDraftSaving('first', store), false);
  assert.equal(readDraftSaving('second', store), true);
  assert.notEqual(draftSavingKey('name:one'), draftSavingKey('name%3Aone'));
  writeDraftSaving('first', true, store);
  assert.equal(readDraftSaving('first', store), true);
});

test('opting out removes only that account’s private drafts and keeps session/retry metadata', () => {
  const store = storage();
  for (const key of [
    savedDraftsKey('first'),
    savedDraftsKey('second'),
    'relay-chat-auth-v1',
    'relay-chat-send-ids-v1:first',
    'relay-chat-action-ids-v1:first',
  ])
    store.setItem(key, 'retained synthetic value');
  writeDraftSaving('first', false, store);
  assert.equal(store.getItem(savedDraftsKey('first')), null);
  for (const key of [
    savedDraftsKey('second'),
    'relay-chat-auth-v1',
    'relay-chat-send-ids-v1:first',
    'relay-chat-action-ids-v1:first',
  ])
    assert.equal(store.getItem(key), 'retained synthetic value');
});

test('preference write failure still attempts to remove saved private copies', () => {
  const store = storage();
  store.setItem(savedDraftsKey('first'), 'synthetic private draft');
  store.setItem = () => {
    throw new Error('blocked writes');
  };
  assert.deepEqual(writeDraftSaving('first', false, store), {
    preferenceSaved: false,
    savedDraftsRemoved: true,
  });
  assert.equal(store.getItem(savedDraftsKey('first')), null);
});

test('a failed removal is disclosed separately while the remembered opt-out blocks restoration', () => {
  const store = storage();
  store.setItem(savedDraftsKey('first'), 'synthetic private draft');
  store.removeItem = () => {
    throw new Error('blocked removal');
  };
  assert.deepEqual(writeDraftSaving('first', false, store), {
    preferenceSaved: true,
    savedDraftsRemoved: false,
  });
  assert.equal(readDraftSaving('first', store), false);
  assert.equal(store.getItem(savedDraftsKey('first')), 'synthetic private draft');
});

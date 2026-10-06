import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreDraftMap } from '../src/lib/draft-storage';
import { MAX_ACTION_BODY_BYTES, MAX_ATTACHMENT_BYTES } from '../src/lib/media-limits';

const conversations = [{ id: 'design' }, { id: 'peer' }];
const file = { name: 'notes.txt', type: 'text/plain', size: 5, url: 'data:text/plain;base64,aGVsbG8=' };

test('invalid JSON and outer shapes restore an empty safe map', () => {
  for (const raw of [null, '', '{', 'null', '12', '"draft"', '[]', '[{"text":"draft"}]']) {
    const map = restoreDraftMap(raw, conversations);
    assert.deepEqual(Object.keys(map), []);
    assert.equal(Object.getPrototypeOf(map), null);
  }
});

test('keeps valid member drafts and valid fields while discarding malformed text/media', () => {
  const map = restoreDraftMap(JSON.stringify({
    design: { text: 'Keep this thought', attachments: [null, file, { ...file, name: { bad: true } }] },
    peer: { text: { bad: true }, attachments: 'not an array' },
    stranger: { text: 'Do not restore another conversation', attachments: [file] },
  }), conversations);
  assert.deepEqual(map.design, { text: 'Keep this thought', attachments: [file] });
  assert.deepEqual(map.peer, { text: '', attachments: [] });
  assert.equal(map.stranger, undefined);
});

test('rejects remote URLs, unsupported active formats and inconsistent base64 metadata', () => {
  for (const malformed of [
    { ...file, url: 'https://example.invalid/track' },
    { ...file, type: 'image/svg+xml', url: 'data:image/svg+xml;base64,aGVsbG8=' },
    { ...file, type: 'text/html', url: 'data:text/html;base64,aGVsbG8=' },
    { ...file, url: 'javascript:alert(1)' },
    { ...file, url: 'data:text/plain;base64,aGVsbG8!' },
    { ...file, size: 6 },
    { ...file, size: MAX_ATTACHMENT_BYTES + 1 },
    { ...file, size: 1.5 },
    { ...file, name: 'x'.repeat(121) },
  ]) {
    const map = restoreDraftMap(JSON.stringify({ design: { text: 'valid', attachments: [malformed] } }), conversations);
    assert.deepEqual(map.design, { text: 'valid', attachments: [] });
  }
});

test('bounds restored text, file count and raw storage size', () => {
  const map = restoreDraftMap(JSON.stringify({ design: { text: 'x'.repeat(6001), attachments: Array(5).fill(file) } }), conversations);
  assert.equal(map.design.text, '');
  assert.equal(map.design.attachments.length, 3);
  assert.deepEqual(Object.keys(restoreDraftMap(' '.repeat(MAX_ACTION_BODY_BYTES + 1), conversations)), []);
});

test('restored own prototype-like keys never pollute another object', () => {
  const map = restoreDraftMap('{"__proto__":{"text":"safe own key","attachments":[]},"constructor":{"text":"safe constructor","attachments":[]}}', [{ id: '__proto__' }, { id: 'constructor' }]);
  assert.equal(Object.getPrototypeOf(map), null);
  assert.equal(map.__proto__.text, 'safe own key');
  assert.equal(Object.getOwnPropertyDescriptor(map, 'constructor')!.value.text, 'safe constructor');
  assert.equal(({} as { text?: string }).text, undefined);
});

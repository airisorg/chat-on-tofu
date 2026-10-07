import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexReplies } from '../src/lib/message-index';

test('thread badges include deleted replies while Home excludes threads with only deleted replies', () => {
  const messages = [
    {},
    {}, // Independent roots do not count as their own replies.
    { parentId: 'mixed' },
    { parentId: 'mixed', deleted: true },
    { parentId: 'mixed' },
    { parentId: 'deleted-only', deleted: true },
    { parentId: 'nested-reply' }, // Preserve parent identity even for nested records.
  ];
  const index = indexReplies(messages);
  assert.deepEqual(
    [...index.counts],
    [
      ['mixed', 3],
      ['deleted-only', 1],
      ['nested-reply', 1],
    ],
  );
  assert.deepEqual([...index.activeRoots], ['mixed', 'nested-reply']);
  assert.equal(index.counts.get('empty-root') || 0, 0);
  assert.equal(index.activeRoots.has('deleted-only'), false);
});

test('the bounded history is inspected once regardless of the number of reply targets', () => {
  let parentReads = 0;
  const messages = Array.from({ length: 2000 }, (_, index) => ({
    get parentId() {
      parentReads++;
      return index % 2 ? `root-${index % 10}` : undefined;
    },
    deleted: index % 3 === 0,
  }));
  const index = indexReplies(messages);
  assert.equal(
    [...index.counts.values()].reduce((total, count) => total + count, 0),
    1000,
  );
  assert.equal(index.counts.size, 5);
  assert.equal(index.activeRoots.size, 5);
  assert.equal(parentReads, messages.length); // Linear traversal, not a timing threshold.
});

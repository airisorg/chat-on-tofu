import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPreviewState,
  PREVIEW_MESSAGE_LIMIT,
  PREVIEW_TEXT_LIMIT,
  reducePreview,
  SAMPLE_MESSAGE,
} from '../src/components/landing-preview-state';

test('empty and whitespace samples do not produce an exchange', () => {
  const empty = createPreviewState();
  assert.strictEqual(reducePreview(empty, { type: 'send' }), empty);
  const whitespace = reducePreview(empty, { type: 'draft', text: ' \n\t ' });
  assert.strictEqual(reducePreview(whitespace, { type: 'send' }), whitespace);
});

test('a send preserves the entered text and adds only a labelled illustrative reply', () => {
  const state = reducePreview(createPreviewState(), { type: 'draft', text: ` ${SAMPLE_MESSAGE} ` });
  const sent = reducePreview(state, { type: 'send' });
  assert.equal(sent.draft, '');
  assert.deepEqual(sent.messages.slice(-2), [
    { id: 3, author: 'You', text: SAMPLE_MESSAGE },
    { id: 4, author: 'Maya', text: 'Perfect. One place for the next steps.', reply: true },
  ]);
  assert.match(sent.status, /illustrative reply/);
  assert.equal(state.draft, ` ${SAMPLE_MESSAGE} `);
});

test('sample history remains bounded without losing the original reaction target', () => {
  let state = createPreviewState();
  const originals = state.messages.slice();
  for (let i = 0; i < 50; i++) {
    state = reducePreview(state, { type: 'draft', text: `Sample ${i}` });
    state = reducePreview(state, { type: 'send' });
    assert.ok(state.messages.length <= PREVIEW_MESSAGE_LIMIT);
    assert.equal(new Set(state.messages.map((message) => message.id)).size, state.messages.length);
  }
  assert.deepEqual(state.messages.slice(0, 2), originals);
  assert.equal(state.messages.at(-2)?.text, 'Sample 49');
  assert.equal(state.messages.length, PREVIEW_MESSAGE_LIMIT);
});

test('preview drafts have a hard bound, including programmatic input', () => {
  const state = reducePreview(createPreviewState(), { type: 'draft', text: 'x'.repeat(5000) });
  assert.equal(state.draft.length, PREVIEW_TEXT_LIMIT);
  assert.equal(
    reducePreview(state, { type: 'send' }).messages.at(-2)?.text.length,
    PREVIEW_TEXT_LIMIT,
  );
});

test('reactions toggle independently from the draft and transcript', () => {
  const original = reducePreview(createPreviewState(), { type: 'draft', text: 'Keep this draft' });
  const selected = reducePreview(original, { type: 'react' });
  assert.equal(selected.reacted, true);
  assert.strictEqual(selected.messages, original.messages);
  assert.equal(selected.draft, original.draft);
  const removed = reducePreview(selected, { type: 'react' });
  assert.equal(removed.reacted, false);
  assert.match(removed.status, /removed/);
});

test('reset removes only the ephemeral interaction and restores the sample', () => {
  let state = reducePreview(createPreviewState(), { type: 'draft', text: 'Unsaved sample' });
  state = reducePreview(state, { type: 'send' });
  state = reducePreview(state, { type: 'react' });
  assert.deepEqual(reducePreview(state, { type: 'reset' }), {
    ...createPreviewState(),
    status: 'Sample conversation reset.',
  });
});

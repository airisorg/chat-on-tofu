import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioDataUrlBytes } from '../src/lib/audio-bytes';
import { MAX_ATTACHMENT_BYTES } from '../src/lib/media-limits';

test('bounded audio data URLs preserve exact binary bytes for each supported canonical type', () => {
  const bytes = Buffer.from([0, 255, 128, 1, 2, 13, 10]);
  for (const type of ['wav', 'mpeg', 'webm', 'mp4', 'ogg']) {
    const result = audioDataUrlBytes(`data:audio/${type};base64,${bytes.toString('base64')}`);
    assert.ok(result);
    assert.deepEqual(Buffer.from(result), bytes);
  }
});

test('malformed or non-audio sources cannot enter the waveform decoder', () => {
  for (const value of ['', 'https://example.invalid/a.wav', 'blob:local',
    'data:text/plain;base64,AA==', 'data:audio/svg+xml;base64,AA==',
    'data:audio/wav,raw', 'data:audio/wav;base64,', 'data:audio/wav;base64,A===',
    'data:audio/wav;base64,AA', 'data:audio/wav;base64,AA==\n',
    'data:audio/wav;base64,@@@@', 'data:audio/wav;base64,AAAA====']) {
    assert.equal(audioDataUrlBytes(value), null, value);
  }
});

test('the inclusive5MiB boundary is measured after base64 decoding', () => {
  const exact = Buffer.alloc(MAX_ATTACHMENT_BYTES, 0xa5);
  const encoded = exact.toString('base64');
  const result = audioDataUrlBytes(`data:audio/wav;base64,${encoded}`);
  assert.ok(result);
  assert.equal(result.byteLength, MAX_ATTACHMENT_BYTES);
  assert.deepEqual(Buffer.from(result), exact);
  // These two encoded strings have equal padded lengths; byte count must still reject the larger one.
  const excess = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64');
  assert.equal(excess.length, encoded.length);
  assert.equal(audioDataUrlBytes(`data:audio/wav;base64,${excess}`), null);
  assert.equal(audioDataUrlBytes(`data:audio/wav;base64,${Buffer.alloc(MAX_ATTACHMENT_BYTES + 4).toString('base64')}`), null);
});

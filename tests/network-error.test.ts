import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { CONNECTION_INTERRUPTED_MESSAGE, errorMessage, normalizeNetworkError } from '../src/lib/network-error';

test('native Chrome, Safari and Firefox fetch failures share useful retry guidance', () => {
  for (const message of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.', 'Network request failed', '  Failed to fetch.  ']) {
    const original = new TypeError(message);
    const normalized = normalizeNetworkError(original);
    assert.ok(normalized instanceof Error);
    assert.equal(normalized.message, CONNECTION_INTERRUPTED_MESSAGE);
    assert.equal(normalized.cause, original);
    assert.equal(errorMessage(original, 'Fallback'), CONNECTION_INTERRUPTED_MESSAGE);
  }
});

test('native NetworkError and cross-realm TypeError normalize without relying on instanceof', () => {
  const native = new DOMException('A network error occurred.', 'NetworkError');
  const otherRealm = runInNewContext('new TypeError("Load failed")') as unknown;
  assert.equal(errorMessage(native, 'Fallback'), CONNECTION_INTERRUPTED_MESSAGE);
  assert.equal(errorMessage(otherRealm, 'Fallback'), CONNECTION_INTERRUPTED_MESSAGE);
});

test('specific API errors and status classifications are never overwritten', () => {
  for (const status of [400, 401, 403, 409, 429, 503]) {
    const original = Object.assign(new Error('Your account cannot perform this action.'), { status });
    assert.equal(normalizeNetworkError(original), original);
    assert.equal(errorMessage(original, 'Fallback'), original.message);
    assert.equal((normalizeNetworkError(original) as typeof original).status, status);
  }
  const apiMessage = new Error('Failed to fetch');
  const classified = Object.assign(new TypeError('Load failed'), { status: 503 });
  assert.equal(normalizeNetworkError(apiMessage), apiMessage, 'matching text alone is not treated as a native transport failure');
  assert.equal(normalizeNetworkError(classified), classified, 'an explicit HTTP error remains authoritative');
});

test('timeouts, cancellation, account changes and unrelated TypeErrors retain their meaning', () => {
  for (const original of [new Error('Connection timed out. Please try again.'), new DOMException('Request cancelled.', 'AbortError'), new Error('Your account changed. Please try again.'), new TypeError('Cannot read properties of undefined'), new TypeError('Failed to fetch an expected field')]) {
    assert.equal(normalizeNetworkError(original), original);
    assert.equal(errorMessage(original, 'Fallback'), original.message);
  }
  for (const unknown of [null, undefined, 'Untrusted error text', { message: 'Untrusted error text' }]) assert.equal(errorMessage(unknown, 'Fallback'), 'Fallback');
});

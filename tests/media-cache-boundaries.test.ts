import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrivateMediaCache } from '../src/lib/media-cache';
import { MAX_ATTACHMENT_BYTES } from '../src/lib/media-limits';
import type { ChatState } from '../src/lib/types';

const bytes = Uint8Array.from([1, 2, 3, 4]);
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(count = 1): ChatState {
  const user = { id: 'cache-owner', name: 'Cache owner', email: 'cache@fixture.invalid' };
  return {
    user,
    conversations: [],
    messages: Array.from({ length: count }, (_, index) => {
      const id = `88888888-8888-4888-8888-${String(index + 1).padStart(12, '0')}`;
      return {
        id,
        conversationId: 'cache-conversation',
        author: user,
        text: '',
        createdAt: '2026-10-07T00:00:00Z',
        reactions: [],
        attachments: [
          {
            name: `${index}.bin`,
            type: 'application/octet-stream',
            size: bytes.length,
            url: `/api/attachments?messageId=${id}&index=0`,
          },
        ],
      };
    }),
  };
}
const response = () =>
  new Response(bytes, {
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) },
  });

test(
  'offline cancellation settles active and queued media without fetching the queued file, then explicit retry recovers',
  { timeout: 5000 },
  async () => {
    const state = fixture(3),
      requested: string[] = [],
      signals: AbortSignal[] = [],
      revoked: string[] = [];
    let online = false;
    const cache = new PrivateMediaCache(
      async (source, signal) => {
        requested.push(source);
        signals.push(signal);
        return online ? response() : new Promise<Response>(() => {});
      },
      () => {},
      { create: () => 'blob:recovered', revoke: (url) => revoked.push(url) },
    );
    try {
      cache.adopt(state);
      const jobs = state.messages.map((message) => cache.load(message.attachments[0].url));
      await turn();
      assert.equal(requested.length, 2, 'the third visible file is genuinely queued');
      cache.abortPending('Connection interrupted. Retry this file.');
      await Promise.all(jobs);
      await turn();
      assert.ok(signals.every((signal) => signal.aborted));
      const failed = cache.materialize(state).messages.map((message) => message.attachments[0]);
      assert.ok(failed.every((file) => file.url === '' && !file.loading));
      assert.ok(failed.every((file) => file.error === 'Connection interrupted. Retry this file.'));
      await Promise.all(state.messages.map((message) => cache.load(message.attachments[0].url)));
      assert.equal(requested.length, 2, 'visibility does not restart cancelled work');
      online = true;
      await cache.load(state.messages[2].attachments[0].url, true);
      assert.equal(requested.length, 3);
      assert.equal(requested[2], state.messages[2].attachments[0].url);
      assert.equal(cache.materialize(state).messages[2].attachments[0].url, 'blob:recovered');
    } finally {
      cache.reset();
    }
    assert.deepEqual(revoked, ['blob:recovered']);
  },
);

test('byte-budget eviction retires the least recently touched file and preserves explicit retry across polls', async () => {
  const state = fixture(3),
    revoked: string[] = [];
  let calls = 0;
  const cache = new PrivateMediaCache(
    async () => {
      calls++;
      return response();
    },
    () => {},
    { create: () => `blob:bytes-${calls}`, revoke: (url) => revoked.push(url) },
    { bytes: 8, files: 10 },
  );
  try {
    cache.adopt(state);
    const sources = state.messages.map((message) => message.attachments[0].url);
    await cache.load(sources[0]);
    await cache.load(sources[1]);
    await cache.load(sources[0]);
    await cache.load(sources[2]);
    assert.equal(calls, 3);
    assert.deepEqual(
      revoked,
      ['blob:bytes-2'],
      'touching the first file protects it from LRU eviction',
    );
    const rendered = cache.materialize(state).messages.map((message) => message.attachments[0]);
    assert.equal(rendered[0].url, 'blob:bytes-1');
    assert.equal(rendered[2].url, 'blob:bytes-3');
    assert.equal(rendered[1].url, '');
    assert.equal(rendered[1].loading, false);
    assert.match(rendered[1].error!, /cleared from memory.*Retry/);
    cache.adopt(structuredClone(state));
    await cache.load(sources[1]);
    assert.equal(calls, 3, 'poll adoption preserves the eviction sentinel');
    await cache.load(sources[1], true);
    assert.equal(calls, 4);
    assert.equal(cache.materialize(state).messages[1].attachments[0].url, 'blob:bytes-4');
    assert.deepEqual(revoked, ['blob:bytes-2', 'blob:bytes-1']);
  } finally {
    cache.reset();
  }
  assert.equal(new Set(revoked).size, 4, 'each created URL is revoked exactly once');
});

test('private media rejects invalid descriptors before network access', async () => {
  let calls = 0;
  const cache = new PrivateMediaCache(
    async () => {
      calls++;
      return response();
    },
    () => {},
  );
  try {
    for (const size of [0, -1, 1.5, MAX_ATTACHMENT_BYTES + 1]) {
      const state = fixture();
      state.messages[0].attachments[0].size = size;
      cache.adopt(state);
      await cache.load(state.messages[0].attachments[0].url, true);
      const file = cache.materialize(state).messages[0].attachments[0];
      assert.equal(file.url, '');
      assert.equal(file.loading, false);
      assert.equal(file.error, 'This file is unavailable.');
    }
    assert.equal(calls, 0);
  } finally {
    cache.reset();
  }
});

test('oversized streamed media cancels its reader rather than creating a partial object URL', async () => {
  for (const [expected, actual] of [
    [bytes.length, bytes.length + 1],
    [MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_BYTES + 1],
  ]) {
    const state = fixture();
    state.messages[0].attachments[0].size = expected;
    let cancelled = 0,
      created = 0;
    const cache = new PrivateMediaCache(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(actual));
            },
            cancel() {
              cancelled++;
            },
          }),
          { headers: { 'Content-Type': 'application/octet-stream' } },
        ),
      () => {},
      {
        create: () => {
          created++;
          return 'blob:invalid';
        },
        revoke: () => {},
      },
    );
    try {
      cache.adopt(state);
      await cache.load(state.messages[0].attachments[0].url);
      assert.equal(cancelled, 1);
      assert.equal(created, 0);
      assert.equal(
        cache.materialize(state).messages[0].attachments[0].error,
        'This file is unavailable.',
      );
    } finally {
      cache.reset();
    }
  }
});

test('missing bodies, oversized advertised lengths and revoked media retain honest retryable error states', async () => {
  const cases = [
    {
      reply: () => new Response(null, { headers: { 'Content-Type': 'application/octet-stream' } }),
      error: 'This file is unavailable.',
    },
    {
      reply: () =>
        new Response(bytes, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(MAX_ATTACHMENT_BYTES + 1),
          },
        }),
      error: 'This file is unavailable.',
    },
    ...[403, 404].map((status) => ({
      reply: () => new Response(null, { status }),
      error: 'This file is no longer available.',
    })),
  ];
  for (const { reply, error } of cases) {
    const state = fixture();
    let calls = 0;
    const cache = new PrivateMediaCache(
      async () => {
        calls++;
        return reply();
      },
      () => {},
    );
    try {
      cache.adopt(state);
      const source = state.messages[0].attachments[0].url;
      await cache.load(source);
      const rendered = cache.materialize(state).messages[0].attachments[0];
      assert.equal(rendered.url, '');
      assert.equal(rendered.loading, false);
      assert.equal(rendered.error, error);
      await cache.load(source);
      assert.equal(calls, 1, 'an error does not cause an automatic redownload');
    } finally {
      cache.reset();
    }
  }
});

test('default object URLs contain exact private bytes and become unusable after reset while inline drafts pass through', async () => {
  const state = fixture();
  const inline = {
    name: 'draft.bin',
    type: 'application/octet-stream',
    size: 1,
    url: 'data:application/octet-stream;base64,AQ==',
  };
  state.messages[0].attachments.push(inline);
  const cache = new PrivateMediaCache(
    async () => response(),
    () => {},
  );
  try {
    cache.adopt(state);
    await cache.load(state.messages[0].attachments[0].url);
    const rendered = cache.materialize(state).messages[0].attachments;
    assert.strictEqual(rendered[1], inline, 'nonprivate draft references are not rewritten');
    assert.match(rendered[0].url, /^blob:/);
    assert.deepEqual(new Uint8Array(await (await fetch(rendered[0].url)).arrayBuffer()), bytes);
    cache.reset();
    await assert.rejects(fetch(rendered[0].url), /fetch|invalid/i);
  } finally {
    cache.reset();
  }
});

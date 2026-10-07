import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import { applySchema, getChat, mutateChat } from '../src/lib/server';
import { PrivateMediaCache } from '../src/lib/media-cache';
import { createDemoState } from '../src/lib/demo';
import type { ChatState } from '../src/lib/types';
import { sqlAdapter } from './helpers/pglite-sql';

// Bounded, disposable local stress. These timings exclude real auth, hosted
// databases and the network; they are not production latency measurements.
const actor = (id: string, email: string): User => ({
  id,
  email,
  email_confirmed_at: '2026-10-05T00:00:00Z',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: { full_name: email.split('@')[0] },
  created_at: '2026-10-05T00:00:00Z',
});
const owner = actor('11111111-1111-4111-8111-111111111111', 'owner@example.com');
const friend = actor('22222222-2222-4222-8222-222222222222', 'friend@example.com');
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function metrics(scenario: string, samples: number[], extra: Record<string, number> = {}) {
  const ordered = [...samples].sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      scope: 'local SQL/cache only',
      scenario,
      samples: samples.length,
      medianMs: Number(ordered[Math.floor(ordered.length / 2)].toFixed(2)),
      p95Ms: Number(ordered[Math.ceil(ordered.length * 0.95) - 1].toFixed(2)),
      ...extra,
    }),
  );
}

test('concurrent sends preserve distinct intents and deduplicate retries', async () => {
  const pg = new PGlite(),
    sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
  try {
    await applySchema(sql);
    const conversationId = (
      await mutateChat(
        owner,
        { type: 'create', kind: 'dm', name: 'Friend', emails: [friend.email!] },
        sql,
      )
    ).id!;
    await getChat(friend, sql);
    const samples: number[] = [];
    const intents = Array.from({ length: 10 }, (_, index) => ({
      type: 'send' as const,
      conversationId,
      clientMessageId: crypto.randomUUID(),
      text: `Distinct intent ${index}`,
    }));
    const sent = await Promise.all(
      intents.map(async (action) => {
        const start = performance.now();
        const result = await mutateChat(owner, action, sql);
        samples.push(performance.now() - start);
        return result;
      }),
    );
    assert.equal(new Set(sent.map((result) => result.id)).size, 10);
    const retry = {
      type: 'send' as const,
      conversationId,
      clientMessageId: crypto.randomUUID(),
      text: 'One ambiguous retry intent',
    };
    const replayed = await Promise.all(
      Array.from({ length: 10 }, () => mutateChat(owner, retry, sql)),
    );
    assert.ok(replayed.every((result) => result.id === retry.clientMessageId));
    const visible = (await getChat(friend, sql)).messages;
    assert.equal(visible.length, 11);
    assert.deepEqual(
      new Set(visible.map((message) => message.text)),
      new Set([...intents.map((action) => action.text), retry.text]),
    );
    assert.equal(
      (await pg.query<{ count: number }>('select count(*)::integer as count from relay.messages'))
        .rows[0].count,
      11,
    );
    metrics('ten concurrent distinct sends', samples, {
      distinctMessages: 10,
      concurrentRetries: 10,
      retryMessages: 1,
    });
  } finally {
    await pg.close();
  }
});

test('deep history remains contiguous and bounded without deleting messages', async () => {
  const pg = new PGlite(),
    sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
  try {
    await applySchema(sql);
    const conversationId = (
      await mutateChat(
        owner,
        { type: 'create', kind: 'space', name: 'History load', emails: [friend.email!] },
        sql,
      )
    ).id!;
    await getChat(friend, sql);
    await pg.query(
      `insert into relay.messages(id,conversation_id,author_id,text,created_at)
      select gen_random_uuid(),$1,$2,'History '||n::text,'2026-10-05T00:00:00Z'::timestamptz+n*interval '1 millisecond'
      from generate_series(1,2100) as n`,
      [conversationId, owner.id],
    );
    const samples: number[] = [];
    let state: ChatState | undefined;
    for (let index = 0; index < 10; index++) {
      const start = performance.now();
      state = await getChat(friend, sql);
      samples.push(performance.now() - start);
      assert.equal(state.messages.length, 2000);
      assert.ok(
        state.messages.every((message, position) => message.text === `History ${position + 101}`),
      );
      assert.equal(new Set(state.messages.map((message) => message.id)).size, 2000);
    }
    assert.ok(Buffer.byteLength(JSON.stringify(state)) < 4 * 1024 * 1024);
    metrics('ten reads after2100 short messages', samples, {
      returnedMessages: state!.messages.length,
      responseBytes: Buffer.byteLength(JSON.stringify(state)),
    });
    await pg.query(
      "update relay.messages set text=repeat('x',5993)||lpad(right(text, strpos(reverse(text),' ')-1),7,'0')",
    );
    const wide = await getChat(friend, sql);
    assert.ok(
      wide.messages.length > 0 && wide.messages.length < 2000,
      'large text must reduce the returned working set',
    );
    const numbers = wide.messages.map((message) => Number(message.text.slice(-7)));
    assert.equal(numbers.at(-1), 2100);
    assert.ok(numbers.every((number, position) => number === numbers[0] + position));
    assert.ok(
      Buffer.byteLength(JSON.stringify(wide)) < 4 * 1024 * 1024,
      'the tested worst-text snapshot stays below the hosted response limit',
    );
    assert.equal(
      (await pg.query<{ count: number }>('select count(*)::integer as count from relay.messages'))
        .rows[0].count,
      2100,
      'response bounds never delete stored history',
    );
    console.log(
      JSON.stringify({
        scope: 'local SQL only',
        scenario: 'maximum-length text history',
        returnedMessages: wide.messages.length,
        storedMessages: 2100,
        responseBytes: Buffer.byteLength(JSON.stringify(wide)),
      }),
    );
  } finally {
    await pg.close();
  }
});

test('repeated identity changes discard late media and revoke every object URL', async () => {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const response = () =>
    new Response(bytes, {
      headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length) },
    });
  const fixture = (identity: string): ChatState => {
    const state = createDemoState();
    state.user.id = identity;
    state.messages = [1, 2].map((number) => {
      const id = `33333333-3333-4333-8333-${String(number).padStart(12, '0')}`;
      return {
        ...state.messages[0],
        id,
        attachments: [
          {
            name: `${number}.png`,
            type: 'image/png',
            size: bytes.length,
            url: `/api/attachments?messageId=${id}&index=0`,
          },
        ],
      };
    });
    return state;
  };
  let release: ((response: Response) => void) | undefined;
  const created: string[] = [],
    revoked: string[] = [],
    samples: number[] = [];
  const signals: AbortSignal[] = [];
  const cache = new PrivateMediaCache(
    async (source, signal) => {
      if (source.includes('000000000002')) {
        signals.push(signal);
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return response();
    },
    () => {},
    {
      create: () => {
        const url = `blob:local-stress-${created.length}`;
        created.push(url);
        return url;
      },
      revoke: (url) => revoked.push(url),
    },
  );
  try {
    for (let cycle = 0; cycle < 20; cycle++) {
      const current = fixture(`identity-${cycle}`);
      cache.adopt(current);
      const start = performance.now();
      await cache.load(current.messages[0].attachments[0].url);
      const readyUrl = cache.materialize(current).messages[0].attachments[0].url;
      assert.ok(readyUrl.startsWith('blob:local-stress-'));
      const late = cache.load(current.messages[1].attachments[0].url);
      await turn();
      assert.ok(release);
      const next = fixture(`identity-${cycle + 1}`);
      cache.adopt(next);
      release!(response());
      release = undefined;
      await late;
      await turn();
      assert.equal(
        created.length,
        cycle + 1,
        'old identity responses never create a new object URL',
      );
      assert.ok(
        cache.materialize(next).messages.every((message) => message.attachments[0].url === ''),
      );
      assert.ok(revoked.includes(readyUrl));
      samples.push(performance.now() - start);
    }
    cache.reset();
    assert.deepEqual(revoked, created);
    assert.equal(signals.length, 20);
    assert.ok(signals.every((signal) => signal.aborted));
    metrics('twenty repeated identity media resets', samples, {
      discardedLateResponses: 20,
      revokedObjectUrls: revoked.length,
    });
  } finally {
    cache.reset();
  }
});

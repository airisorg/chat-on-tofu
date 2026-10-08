import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import type { ChatState } from '../src/lib/types';
import { sqlAdapter } from './helpers/pglite-sql';

const childFlag = 'CHAT_ROUTE_INTEGRATION_CHILD';
const databaseUrl = 'postgres://synthetic:synthetic@127.0.0.1:1/route_fixture';

if (process.env[childFlag] !== '1') {
  test(
    'actual API handlers integrate verified identity, SQL, media ownership and quotas',
    {
      timeout: 90_000,
    },
    () => {
      // Module mocking is enabled only in this disposable test process. The app
      // retains its real imports and has no injection endpoint or test-only flag.
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        [childFlag]: '1',
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        DATABASE_CA_CERT: '',
        SUPABASE_URL: 'https://identity.route-fixture.invalid',
        SUPABASE_ANON_KEY: 'sb_publishable_route_fixture',
        NEXT_PUBLIC_SUPABASE_URL: 'https://identity.route-fixture.invalid',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_route_fixture',
      };
      // The nested test runner needs its own reporting context, not its
      // parent's internal worker channel. Keep the coverage preload unchanged.
      delete environment.NODE_TEST_CONTEXT;
      const child = spawnSync(
        process.execPath,
        [
          '--experimental-test-module-mocks',
          '--import',
          'tsx',
          '--test',
          '--test-reporter=tap',
          fileURLToPath(import.meta.url),
        ],
        {
          encoding: 'utf8',
          timeout: 75_000,
          env: environment,
        },
      );
      assert.ifError(child.error);
      assert.equal(child.status, 0, child.stdout + child.stderr);
      assert.match(child.stdout, /# pass 1\b/);
    },
  );
} else {
  test(
    'configured handlers share one private database and enforce the real SQL contracts',
    {
      timeout: 60_000,
    },
    async (t) => {
      const pg = new PGlite();
      try {
        await pg.query('select 1');
        const sql = sqlAdapter(pg, (work) => pg.transaction(work));
        let constructions = 0;
        const factory = (url: string, options: Record<string, unknown>) => {
          assert.equal(url, databaseUrl);
          assert.equal(options.max, 3);
          assert.equal(options.prepare, false);
          assert.equal(options.ssl, undefined);
          constructions++;
          return sql;
        };
        const require = createRequire(import.meta.url);
        t.mock.module('postgres', { defaultExport: factory });
        // tsx's CommonJS and ESM resolutions use different package export paths.
        t.mock.module(require.resolve('postgres'), { defaultExport: factory });
        t.mock.method(net.Socket.prototype, 'connect', () => {
          throw new Error('This local route fixture forbids real socket connections.');
        });
        const identity = (name: string): User => ({
          id: crypto.randomUUID(),
          email: `${name.toLowerCase()}@route-fixture.invalid`,
          email_confirmed_at: '2026-10-05T00:00:00Z',
          aud: 'authenticated',
          app_metadata: { provider: 'google', providers: ['google'] },
          user_metadata: { name },
          created_at: '2026-10-05T00:00:00Z',
        });
        const owner = identity('Owner'),
          peer = identity('Peer'),
          outsider = identity('Outsider');
        const tokens = new Map<string, User>(
          [owner, peer, outsider].map((user) => [`synthetic-route-token-${user.id}`, user]),
        );
        let authCalls = 0;
        t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
          assert.equal(String(input), 'https://identity.route-fixture.invalid/auth/v1/user');
          authCalls++;
          const token = new Headers(init?.headers).get('authorization')?.slice(7);
          const user = token ? tokens.get(token) : undefined;
          return user ? Response.json(user) : Response.json({ code: 'bad_jwt' }, { status: 401 });
        });
        const chat = await import('../src/app/api/chat/route');
        const uploads = await import('../src/app/api/uploads/route');
        const media = await import('../src/app/api/attachments/route');
        const request = (user: User, path: string, body?: unknown) =>
          new Request(`https://chat.route-fixture.invalid${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
              Authorization: `Bearer synthetic-route-token-${user.id}`,
              Origin: 'https://chat.route-fixture.invalid',
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        const json = async (response: Response, expected = 200) => {
          const result = (await response.json()) as {
            state: ChatState;
            id?: string;
            actionId?: string;
            error?: string;
          };
          assert.equal(response.status, expected, JSON.stringify(result));
          assert.match(response.headers.get('cache-control')!, /no-store/);
          return result;
        };
        const operation = (action: Record<string, unknown>) => ({
          ...action,
          clientActionId: crypto.randomUUID(),
          clientActionCreatedAt: new Date().toISOString(),
        });

        assert.equal(
          (await json(await chat.GET(request(owner, '/api/chat')))).state.user.id,
          owner.id,
        );
        const create = operation({
          type: 'create',
          name: 'Route group',
          kind: 'group',
          emails: [peer.email],
        });
        const created = await json(await chat.POST(request(owner, '/api/chat', create)));
        assert.ok(created.id);
        const conversationId = created.id;
        assert.equal(
          created.state.conversations[0].members.some((member) => member.id === peer.id),
          false,
          'email invitations must wait for verified claim',
        );
        const claimed = await json(await chat.GET(request(peer, '/api/chat')));
        assert.deepEqual(
          claimed.state.conversations[0].members.map((member) => member.id).sort(),
          [owner.id, peer.id].sort(),
        );
        const lookup = await json(
          await chat.GET(request(owner, `/api/chat?clientActionId=${create.clientActionId}`)),
        );
        assert.equal(lookup.actionId, create.clientActionId);
        assert.equal(lookup.id, conversationId);

        const bytes = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfAAAAABJRU5ErkJggg==',
          'base64',
        );
        const messageId = crypto.randomUUID();
        const chunk = {
          clientMessageId: messageId,
          conversationId,
          attachmentIndex: 0,
          name: 'private.png',
          type: 'image/png',
          size: bytes.length,
          chunkIndex: 0,
          totalChunks: 1,
          data: bytes.toString('base64'),
        };
        await json(await uploads.POST(request(owner, '/api/uploads', chunk)));
        const staging = (await pg.query('select owner_id from relay.uploads')).rows as Array<{
          owner_id: string;
        }>;
        assert.deepEqual(staging, [{ owner_id: owner.id }]);
        await json(await uploads.POST(request(outsider, '/api/uploads', chunk)), 404);
        const send = {
          type: 'send',
          clientMessageId: messageId,
          conversationId,
          text: 'Private route image',
          attachments: [
            { name: chunk.name, type: chunk.type, size: chunk.size, url: `upload:${messageId}:0` },
          ],
        };
        const saved = await json(await chat.POST(request(owner, '/api/chat', send)));
        assert.equal(saved.state.messages.filter((message) => message.id === messageId).length, 1);
        assert.equal(
          saved.state.messages.find((message) => message.id === messageId)!.attachments[0].url,
          `/api/attachments?messageId=${messageId}&index=0`,
          'the state response must contain a protected reference, never inline private bytes',
        );
        assert.equal((await pg.query('select message_id from relay.uploads')).rows.length, 0);
        const eventsBefore = (await pg.query('select id from relay.events')).rows.length;
        await json(await chat.POST(request(owner, '/api/chat', send)));
        assert.equal((await pg.query('select id from relay.events')).rows.length, eventsBefore);
        assert.equal((await pg.query('select id from relay.messages')).rows.length, 1);

        const download = await media.GET(
          request(peer, `/api/attachments?messageId=${messageId}&index=0`),
        );
        assert.equal(download.status, 200);
        assert.equal(download.headers.get('content-type'), 'image/png');
        assert.equal(download.headers.get('content-length'), String(bytes.length));
        assert.equal(download.headers.get('vary'), 'Authorization');
        assert.equal(download.headers.get('cache-control'), 'private, no-store, max-age=0');
        assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
        assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
        await json(
          await media.GET(request(outsider, `/api/attachments?messageId=${messageId}&index=0`)),
          404,
        );
        await json(
          await chat.POST(request(peer, '/api/chat', operation({ type: 'leave', conversationId }))),
        );
        await json(
          await media.GET(request(peer, `/api/attachments?messageId=${messageId}&index=0`)),
          404,
        );
        assert.equal(
          (await json(await chat.GET(request(peer, '/api/chat')))).state.conversations.length,
          0,
        );

        // Cover adjacent minute windows so a clock rollover cannot turn the quota
        // boundary test into an intermittent successful write.
        await pg.query(
          `insert into relay.request_limits(owner_id,bucket,window_start,requests)
          select $1,'write',date_trunc('minute',now())+slots.delta*interval '1 minute',120
          from generate_series(-2,2) as slots(delta)
        on conflict(owner_id,bucket,window_start) do update set requests=120`,
          [owner.id],
        );
        const rejected = operation({ type: 'profile', name: 'Blocked by quota' });
        await json(await chat.POST(request(owner, '/api/chat', rejected)), 429);
        assert.equal(
          (await pg.query('select id from relay.operations where id=$1', [rejected.clientActionId]))
            .rows.length,
          0,
        );
        const profile = (await pg.query('select name from relay.profiles where id=$1', [owner.id]))
          .rows[0] as { name: string };
        assert.equal(profile.name, 'Owner');
        assert.equal(
          constructions,
          1,
          'the API handlers must share the initialized connection factory',
        );
        assert.equal(authCalls, 14, 'all fourteen actual handler requests verify their identity');
      } finally {
        await pg.close();
      }
    },
  );
}

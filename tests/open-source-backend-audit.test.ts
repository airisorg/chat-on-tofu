import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import type postgres from 'postgres';
import {
  applySchema,
  enforceRequestLimit,
  getChat,
  mutateChat,
  SCHEMA,
  validateAttachments,
} from '../src/lib/server';
import { verifyDatabase } from '../scripts/verify-database';
import { sqlAdapter } from './helpers/pglite-sql';

const tableNames = [
  'schema_migrations',
  'profiles',
  'conversations',
  'participants',
  'invites',
  'messages',
  'reactions',
  'stars',
  'events',
  'uploads',
  'operations',
  'request_limits',
];
const identity = (label: string): User => ({
  id: crypto.randomUUID(),
  email: `${label}@bootstrap-audit.invalid`,
  email_confirmed_at: new Date().toISOString(),
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: { name: label },
  created_at: new Date().toISOString(),
});

test('executable schema snapshot matches runtime DDL and preserves private access on migration', async () => {
  const snapshot = await readFile(new URL('../migrations/schema.sql', import.meta.url), 'utf8');
  const pg = new PGlite(),
    sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
  const owner = identity('owner'),
    peer = identity('peer');
  try {
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE PUBLICATION supabase_realtime;`);
    await pg.exec(snapshot);
    const tables = (
      await pg.query<{ relname: string; relrowsecurity: boolean }>(
        "select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='relay' and c.relkind='r' order by c.relname",
      )
    ).rows;
    assert.deepEqual(
      tables.map((row) => row.relname),
      [...tableNames].sort(),
      'manual bootstrap must not omit runtime tables',
    );
    assert.ok(tables.every((row) => row.relrowsecurity));
    for (const role of ['anon', 'authenticated']) {
      for (const table of tableNames) {
        const grants = (
          await pg.query<{ select: boolean; insert: boolean; update: boolean; delete: boolean }>(
            "select has_table_privilege($1,$2,'SELECT') as select,has_table_privilege($1,$2,'INSERT') as insert,has_table_privilege($1,$2,'UPDATE') as update,has_table_privilege($1,$2,'DELETE') as delete",
            [role, `relay.${table}`],
          )
        ).rows[0];
        assert.deepEqual(
          grants,
          {
            select: role === 'authenticated' && table === 'events',
            insert: false,
            update: false,
            delete: false,
          },
          'snapshot access is checked before applySchema can repair it',
        );
      }
    }
    const core = snapshot
      .split('-- BEGIN RUNTIME SCHEMA\n')[1]
      ?.split('-- END RUNTIME SCHEMA')[0]
      ?.trim();
    assert.equal(
      core,
      SCHEMA.trim(),
      'the checked snapshot cannot silently drift from the runtime schema',
    );
    await getChat(owner, sql);
    await getChat(peer, sql);
    const conversationId = (
      await mutateChat(
        owner,
        { type: 'create', kind: 'dm', name: 'Bootstrap preservation', emails: [peer.email!] },
        sql,
      )
    ).id!;
    await getChat(peer, sql);
    await mutateChat(owner, { type: 'send', conversationId, text: 'Existing private data' }, sql);
    await applySchema(sql);
    assert.equal((await getChat(peer, sql)).messages[0].text, 'Existing private data');
    assert.equal(
      (await pg.query('select version from relay.schema_migrations where version=6')).rows.length,
      1,
    );
    for (const role of ['anon', 'authenticated']) {
      await pg.exec(`SET ROLE ${role}`);
      for (const table of tableNames.filter((name) => name !== 'events'))
        await assert.rejects(pg.query(`select * from relay.${table}`), /permission denied/);
      if (role === 'anon')
        await assert.rejects(pg.query('select * from relay.events'), /permission denied/);
      else {
        await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [peer.id]);
        const own = (await pg.query<{ user_id: string }>('select user_id from relay.events')).rows;
        assert.ok(own.length > 0);
        assert.ok(
          own.every((row) => row.user_id === peer.id),
          'the only browser-readable table still filters by verified identity',
        );
        await assert.rejects(pg.query('delete from relay.events'), /permission denied/);
      }
      await pg.exec('RESET ROLE');
    }
  } finally {
    await pg.close();
  }
});

test('a non-string provider display name still bounds the verified-email fallback to eighty characters', async () => {
  const pg = new PGlite(),
    sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
  const local = 'a'.repeat(225),
    owner = {
      ...identity('name-fallback'),
      email: `${local}@audit.invalid`,
      user_metadata: { full_name: 123 },
    };
  try {
    await applySchema(sql);
    const state = await getChat(owner, sql);
    assert.equal(state.user.name, local.slice(0, 80));
    assert.equal(
      (await pg.query<{ name: string }>('select name from relay.profiles where id=$1', [owner.id]))
        .rows[0].name.length,
      80,
    );
  } finally {
    await pg.close();
  }
});

test('attachment names cannot become empty after control-character sanitization', () => {
  const bytes = Buffer.from('Safe plain text'),
    file = {
      name: '\u0000\u007f',
      type: 'text/plain',
      url: `data:text/plain;base64,${bytes.toString('base64')}`,
      size: bytes.length,
    };
  assert.throws(() => validateAttachments([file]), /Filename/);
  assert.equal(
    validateAttachments([{ ...file, name: 'safe\u0000name.txt' }])[0].name,
    'safename.txt',
  );
});

test('database build gate preserves sanitized verification and teardown failures', async () => {
  const factory = (() => ({
    unsafe: async () => {
      throw new Error('synthetic-private-driver-detail');
    },
    end: async () => {
      throw new Error('synthetic-private-cleanup-detail');
    },
  })) as unknown as typeof postgres;
  await assert.rejects(
    verifyDatabase({ DATABASE_URL: 'postgres://fixture@localhost/fixture' }, factory),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.match(error.errors[0].message, /Database TLS verification failed/);
      assert.match(error.errors[1].message, /cleanup failed/);
      assert.doesNotMatch(
        JSON.stringify(error.errors.map((entry: Error) => entry.message)),
        /synthetic-private/,
      );
      return true;
    },
  );
});

test('first read quota in a minute retires only a bounded set of expired own invalidations', async () => {
  const pg = new PGlite(),
    sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
  const owner = identity('event-owner'),
    peer = identity('event-peer');
  try {
    await applySchema(sql);
    await getChat(owner, sql);
    await getChat(peer, sql);
    for (const account of [owner, peer]) {
      await pg.query(
        "insert into relay.events(id,user_id,created_at) select gen_random_uuid(),$1,now()-interval '30 days' from generate_series(1,750)",
        [account.id],
      );
      await pg.query('insert into relay.events(id,user_id) values(gen_random_uuid(),$1)', [
        account.id,
      ]);
    }
    await enforceRequestLimit(owner, 'read', sql);
    const oldCount = async (id: string) =>
      Number(
        (
          await pg.query<{ count: number }>(
            "select count(*)::int as count from relay.events where user_id=$1 and created_at<now()-interval '1 day'",
            [id],
          )
        ).rows[0].count,
      );
    assert.equal(await oldCount(owner.id), 250);
    assert.equal(
      await oldCount(peer.id),
      750,
      'opportunistic cleanup must not claim global retention or modify another account',
    );
    await enforceRequestLimit(owner, 'read', sql);
    await enforceRequestLimit(owner, 'write', sql);
    assert.equal(
      await oldCount(owner.id),
      250,
      'later reads and other buckets do not add cleanup work within the minute',
    );
    assert.equal(
      Number(
        (
          await pg.query<{ count: number }>(
            "select count(*)::int as count from relay.events where created_at>=now()-interval '1 day'",
          )
        ).rows[0].count,
      ),
      2,
    );
    await pg.query(
      "update relay.request_limits set window_start=window_start-interval '1 minute' where owner_id=$1 and bucket='read'",
      [owner.id],
    );
    await enforceRequestLimit(owner, 'read', sql);
    assert.equal(await oldCount(owner.id), 0);
  } finally {
    await pg.close();
  }
});

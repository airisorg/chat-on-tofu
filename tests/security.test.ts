import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import { applySchema, enforceRequestLimit, getChat } from '../src/lib/server';
import { contentSecurityPolicy } from '../src/lib/security-headers';
import { sqlAdapter } from './helpers/pglite-sql';

test('request limits isolate verified accounts and buckets, reject overflow and retire old windows', async () => {
  const pg = new PGlite();
  const sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
  const alice = { id: crypto.randomUUID() } as User,
    bob = { id: crypto.randomUUID() } as User;
  try {
    await applySchema(sql);
    await pg.query(
      "insert into relay.request_limits values($1,'write',date_trunc('minute',now()),119)",
      [alice.id],
    );
    await enforceRequestLimit(alice, 'write', sql);
    await assert.rejects(
      enforceRequestLimit(alice, 'write', sql),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 429,
    );
    await enforceRequestLimit(bob, 'write', sql);
    await enforceRequestLimit(alice, 'upload', sql);
    await pg.query(
      "insert into relay.request_limits values($1,'read',date_trunc('minute',now())-interval '3 minutes',600)",
      [alice.id],
    );
    await enforceRequestLimit(alice, 'read', sql);
    const rows = (
      await pg.query<{ owner_id: string; bucket: string; requests: number }>(
        'select owner_id,bucket,requests from relay.request_limits',
      )
    ).rows;
    assert.equal(rows.length, 4);
    assert.equal(
      rows.find((row) => row.owner_id === alice.id && row.bucket === 'write')?.requests,
      120,
    );
    assert.equal(rows.find((row) => row.owner_id === bob.id)?.requests, 1);
    assert.equal(rows.find((row) => row.bucket === 'read')?.requests, 1);
    const privateTable = (
      await pg.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where oid='relay.request_limits'::regclass",
      )
    ).rows[0];
    assert.equal(privateTable.relrowsecurity, true);
  } finally {
    await pg.close();
  }
});

test('production policy rejects unsafe provider origins and excludes development script privileges', () => {
  const policy = contentSecurityPolicy('test-nonce', 'https://identity.example/auth/');
  assert.match(policy, /connect-src 'self' https:\/\/identity\.example wss:\/\/identity\.example;/);
  assert.match(policy, /script-src 'self' 'nonce-test-nonce' 'strict-dynamic';/);
  assert.doesNotMatch(policy, /unsafe-eval/);
  const images = policy
    .split(';')
    .find((rule) => rule.trim().startsWith('img-src'))!
    .trim()
    .split(/\s+/);
  assert.deepEqual(images, [
    'img-src',
    "'self'",
    'data:',
    'blob:',
    'https://googleusercontent.com',
    'https://*.googleusercontent.com',
    'https://gstatic.com',
    'https://*.gstatic.com',
  ]);
  assert.doesNotMatch(
    policy.split(';').find((rule) => rule.trim().startsWith('script-src'))!,
    /unsafe-inline/,
  );
  for (const origin of [
    'http://identity.example',
    'https://user:pass@identity.example',
    'javascript:alert(1)',
  ]) {
    assert.equal(
      contentSecurityPolicy('nonce', origin)
        .split(';')
        .find((rule) => rule.trim().startsWith('connect-src'))
        ?.trim(),
      "connect-src 'self'",
    );
  }
});

test('profile responses accept Google images and reject arbitrary or deceptive avatar hosts including old rows', async () => {
  const pg = new PGlite();
  const sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
  const owner: User = {
    id: crypto.randomUUID(),
    email: 'avatar@security.test.invalid',
    email_confirmed_at: new Date().toISOString(),
    user_metadata: { picture: 'https://lh3.googleusercontent.com/avatar' },
    app_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };
  try {
    await applySchema(sql);
    assert.equal((await getChat(owner, sql)).user.avatar, owner.user_metadata.picture);
    for (const avatar of [
      'https://tracker.example/avatar',
      'https://googleusercontent.com.evil.example/avatar',
      'http://lh3.googleusercontent.com/avatar',
      'https://user:pass@lh3.googleusercontent.com/avatar',
    ]) {
      await pg.query('update relay.profiles set avatar=$1 where id=$2', [avatar, owner.id]);
      assert.equal((await getChat(owner, sql)).user.avatar, undefined);
    }
    await pg.query('update relay.profiles set avatar=$1 where id=$2', [
      'https://ssl.gstatic.com/avatar',
      owner.id,
    ]);
    assert.equal((await getChat(owner, sql)).user.avatar, 'https://ssl.gstatic.com/avatar');
  } finally {
    await pg.close();
  }
});

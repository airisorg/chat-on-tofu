import assert from 'node:assert/strict';
import { X509Certificate, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createSecureContext } from 'node:tls';
import { test } from 'node:test';
import postgres from 'postgres';
import { databaseTls } from '../src/lib/database-tls';
import { SUPABASE_DATABASE_CA_PEM } from '../src/lib/supabase-ca';
import { verifyDatabase } from '../scripts/verify-database';

const local = 'postgres://synthetic_fixture@127.0.0.1:5432/example';
const pooler = 'postgres://synthetic_fixture@aws-0-eu-west-1.pooler.supabase.com:6543/example';
const direct = 'postgres://synthetic_fixture@db.abcdefghijklmnopqrst.supabase.co:5432/example';

test('production always verifies peers and retains the default hostname checker', () => {
  assert.deepEqual(databaseTls(local, { NODE_ENV: 'production' }), { rejectUnauthorized: true });
  assert.deepEqual(databaseTls('postgres://synthetic@other.database.test.invalid/example', {}), {
    rejectUnauthorized: true,
  });
  assert.equal(databaseTls(local, { NODE_ENV: 'development' }), undefined);
  assert.equal(databaseTls('postgres://synthetic@[::1]/example', { NODE_ENV: 'test' }), undefined);
});

test('official public Supabase CA bytes and identity are bound to the audited download', () => {
  assert.equal(
    createHash('sha256').update(SUPABASE_DATABASE_CA_PEM).digest('hex'),
    '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7',
  );
  const certificate = new X509Certificate(SUPABASE_DATABASE_CA_PEM);
  assert.equal(certificate.ca, true);
  assert.equal(certificate.verify(certificate.publicKey), true);
  assert.equal(
    certificate.fingerprint256.replaceAll(':', ''),
    '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA',
  );
});

test('only recognized Supabase database hosts gain the additional official CA', () => {
  for (const url of [pooler, direct]) {
    const options = databaseTls(url, { NODE_ENV: 'production' })!;
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.checkServerIdentity, undefined);
    assert.equal(options.servername, undefined, 'driver uses the actual URL hostname');
    assert.ok(Array.isArray(options.ca));
    assert.ok(options.ca.includes(SUPABASE_DATABASE_CA_PEM));
    assert.ok(options.ca.length > 1, 'default roots remain alongside the additional root');
    createSecureContext(options);
  }
  for (const host of [
    'pooler.supabase.com.evil.invalid',
    'evilpooler.supabase.com',
    'db.abcdefghijklmnopqrst.supabase.co.evil.invalid',
  ]) {
    assert.deepEqual(
      databaseTls('postgres://synthetic@' + host + '/example', { NODE_ENV: 'production' }),
      { rejectUnauthorized: true },
    );
  }
});

test('explicit CA accepts actual and escaped PEM newlines without disabling hostname verification', () => {
  for (const value of [
    SUPABASE_DATABASE_CA_PEM,
    SUPABASE_DATABASE_CA_PEM.replaceAll('\n', '\\n'),
    SUPABASE_DATABASE_CA_PEM.replaceAll('\n', '\\r\\n'),
  ]) {
    const options = databaseTls(local, { NODE_ENV: 'production', DATABASE_CA_CERT: value })!;
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.checkServerIdentity, undefined);
    assert.ok(Array.isArray(options.ca));
    assert.equal(options.ca.at(-1), SUPABASE_DATABASE_CA_PEM);
    createSecureContext(options);
  }
});

test('invalid or oversized CA content fails without exposing operator input', () => {
  for (const value of [
    'synthetic-sensitive-value',
    SUPABASE_DATABASE_CA_PEM + '\nsynthetic-sensitive-value',
    SUPABASE_DATABASE_CA_PEM + ' '.repeat(65536),
  ]) {
    assert.throws(
      () => databaseTls(local, { NODE_ENV: 'production', DATABASE_CA_CERT: value }),
      (error) =>
        error instanceof Error &&
        error.message === 'The configured database CA must be valid PEM CA certificates.' &&
        !error.message.includes('synthetic-sensitive-value'),
    );
  }
  assert.throws(
    () => databaseTls('https://synthetic.test.invalid/path', {}),
    /connection settings are invalid/,
  );
});

test('explicit verification outranks insecure URL and PGSSL options in the installed driver', async () => {
  const previous = process.env.PGSSL;
  process.env.PGSSL = 'require';
  const clients: ReturnType<typeof postgres>[] = [];
  try {
    for (const mode of ['require', 'disable', 'prefer']) {
      const url = pooler + '?sslmode=' + mode;
      const options = databaseTls(url, { NODE_ENV: 'production' })!;
      const client = postgres(url, { ssl: options, max: 1, prepare: false });
      clients.push(client);
      assert.equal(typeof client.options.ssl, 'object');
      assert.equal(
        (client.options.ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized,
        true,
      );
      assert.deepEqual(client.options.ssl, options);
    }
  } finally {
    if (previous === undefined) delete process.env.PGSSL;
    else process.env.PGSSL = previous;
    await Promise.all(clients.map((client) => client.end({ timeout: 0 })));
  }
  // Lazy driver construction performed no connection/query.
});

type FakeBehavior = {
  connectError?: boolean;
  queryError?: boolean;
  hangConnect?: boolean;
  hangQuery?: boolean;
  hangClose?: boolean;
  verified?: number;
};
function fakeProbe(behavior: FakeBehavior = {}) {
  const order: string[] = [],
    queries: string[] = [];
  let options: Record<string, unknown> | undefined;
  const never = () => new Promise<never>(() => {});
  const factory = ((_url: string, settings: Record<string, unknown>) => {
    options = settings;
    return {
      async unsafe(query: string) {
        order.push('connect');
        if (behavior.connectError) throw new Error('synthetic-sensitive-driver-value');
        if (behavior.hangConnect) return never();
        (settings.debug as () => void)();
        order.push('query');
        queries.push(query);
        if (behavior.queryError) throw new Error('synthetic-sensitive-driver-value');
        if (behavior.hangQuery) return never();
        return [{ verified: behavior.verified ?? 1 }];
      },
      async end(settings: { timeout: number }) {
        order.push('end');
        assert.equal(settings.timeout, 2);
        if (behavior.hangClose) return never();
      },
    };
  }) as unknown as typeof postgres;
  return { factory, order, queries, options: () => options };
}

test('build gate forces strict TLS, connects first, selects once and closes', async () => {
  const fake = fakeProbe();
  assert.equal(await verifyDatabase({ DATABASE_URL: local }, fake.factory), 'verified');
  assert.deepEqual(fake.order, ['connect', 'query', 'end']);
  assert.deepEqual(fake.queries, ['select 1 as verified']);
  assert.deepEqual(
    fake.options()!.ssl,
    { rejectUnauthorized: true },
    'NODE_ENV absence never skips verification for configured builds',
  );
  assert.equal(fake.options()!.fetch_types, false, 'no driver type-introspection query');
  assert.equal(fake.options()!.connect_timeout, 15);
});

test('missing URL skips only a local build and refuses known hosted deployments', async () => {
  const fake = fakeProbe();
  assert.equal(await verifyDatabase({}, fake.factory), 'skipped');
  for (const marker of [{ VERCEL: '1' }, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview' }]) {
    await assert.rejects(verifyDatabase(marker, fake.factory), /DATABASE_URL is missing/);
  }
  assert.deepEqual(fake.order, []);
});

test('build gate fails and closes on certificate/auth/query/result errors without raw diagnostics', async () => {
  for (const behavior of [{ connectError: true }, { queryError: true }, { verified: 0 }]) {
    const fake = fakeProbe(behavior);
    await assert.rejects(
      verifyDatabase({ DATABASE_URL: local }, fake.factory),
      (error) =>
        error instanceof Error &&
        error.message.startsWith('Database TLS verification failed.') &&
        !error.message.includes('synthetic-sensitive-driver-value'),
    );
    assert.equal(fake.order.at(-1), 'end');
  }
});

test('build connect/query/cleanup deadlines are bounded and fail publication', async () => {
  for (const behavior of [{ hangConnect: true }, { hangQuery: true }, { hangClose: true }]) {
    const fake = fakeProbe(behavior);
    await assert.rejects(
      verifyDatabase({ DATABASE_URL: local }, fake.factory, { connect: 15, query: 15, close: 15 }),
      /Deployment stopped/,
    );
    assert.equal(fake.order.at(-1), 'end');
  }
});

test('actual verification CLI skips an unconfigured local environment and fails a hosted one without a stack', () => {
  const localRun = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-database.ts'], {
    env: { NODE_ENV: 'test' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(localRun.status, 0);
  assert.match(localRun.stdout, /skipped: no local DATABASE_URL/);
  assert.equal(localRun.stderr, '');
  const hostedRun = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-database.ts'], {
    env: { NODE_ENV: 'test', VERCEL: '1' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(hostedRun.status, 1);
  assert.equal(hostedRun.stdout, '');
  assert.equal(
    hostedRun.stderr.trim(),
    'Hosted deployment requires database TLS verification; DATABASE_URL is missing.',
  );
});

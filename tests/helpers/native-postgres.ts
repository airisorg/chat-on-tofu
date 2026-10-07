import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import postgres from 'postgres';
import type { User } from '@supabase/supabase-js';

const exec = promisify(execFile);
export const nativeEnabled = Boolean(process.env.CHAT_NATIVE_WORK_DIR);
export const nativeSkip =
  'Opt in with CHAT_NATIVE_WORK_DIR pointing to a disposable work directory; native PostgreSQL is never started by the default unit run.';
const pgBin = process.env.CHAT_NATIVE_PG_BIN || '/opt/homebrew/bin';
const openssl = process.env.CHAT_NATIVE_OPENSSL || '/opt/homebrew/bin/openssl';

export function fixtureUser(label: string): User {
  return {
    id: crypto.randomUUID(),
    email: `${label}@native-test.invalid`,
    email_confirmed_at: '2026-10-05T00:00:00Z',
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: { full_name: label },
    created_at: '2026-10-05T00:00:00Z',
  };
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No loopback port allocated.');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

export async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
  try {
    await exit;
  } finally {
    clearTimeout(timer);
  }
}

export async function nativeCluster(label: string) {
  if (!nativeEnabled) throw new Error(nativeSkip);
  const base = resolve(process.env.CHAT_NATIVE_WORK_DIR!);
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(base, `${label}-`));
  await chmod(root, 0o700);
  const data = join(root, 'data'),
    keyPath = join(root, 'fixture.key'),
    certPath = join(root, 'fixture.crt');
  const clients: postgres.Sql[] = [];
  let initialized = false,
    startupAttempted = false,
    started = false,
    closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    const failures: unknown[] = [];
    for (const client of clients)
      try {
        await client.end({ timeout: 2 });
      } catch (error) {
        failures.push(error);
      }
    let stopped = !initialized;
    if (initialized) {
      try {
        // A timed-out pg_ctl start can still have launched its daemon. Inspect
        // only our exact mkdtemp cluster; never infer ownership from a port.
        await exec(join(pgBin, 'pg_ctl'), ['-D', data, 'status'], { timeout: 5000 });
        await exec(join(pgBin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], {
          timeout: 15000,
        });
        stopped = true;
      } catch (error) {
        const noServer = error && typeof error === 'object' && 'code' in error && error.code === 3;
        stopped = Boolean(noServer && (!startupAttempted || started));
        if (!stopped) failures.push(error);
      }
    }
    // Remove only the mkdtemp directory this fixture created, never a supplied cluster.
    if (stopped) await rm(root, { recursive: true, force: true });
    if (failures.length)
      throw new Error(
        `Disposable native PostgreSQL cleanup failed; retained any running cluster at ${root}.`,
      );
  }
  try {
    await exec(
      openssl,
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-noenc',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1,DNS:localhost',
        '-days',
        '1',
        '-keyout',
        keyPath,
        '-out',
        certPath,
      ],
      { timeout: 15000 },
    );
    await chmod(keyPath, 0o600);
    await exec(
      join(pgBin, 'initdb'),
      [
        '-D',
        data,
        '--username=chat_fixture',
        '--encoding=UTF8',
        '--locale=C',
        '--auth-local=trust',
        '--auth-host=trust',
        '--no-sync',
      ],
      { timeout: 30000 },
    );
    initialized = true;
    const port = await freePort();
    // No shared socket and no non-loopback listener. Arguments refer only to this new cluster.
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    const options = `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c ssl=on -c ssl_cert_file=${quote(certPath)} -c ssl_key_file=${quote(keyPath)}`;
    startupAttempted = true;
    await exec(
      join(pgBin, 'pg_ctl'),
      ['-D', data, '-l', join(root, 'postgres.log'), '-o', options, '-w', 'start'],
      { timeout: 30000 },
    );
    started = true;
    const certificate = await readFile(certPath, 'utf8');
    const url = `postgres://chat_fixture@127.0.0.1:${port}/postgres`;
    function client(
      ssl: postgres.Options<Record<string, postgres.PostgresType>>['ssl'] = {
        ca: certificate,
        rejectUnauthorized: true,
      },
    ) {
      const connection = postgres(url, {
        max: 1,
        prepare: false,
        ssl,
        connect_timeout: 5,
        idle_timeout: 0,
        onnotice: () => {},
      });
      clients.push(connection);
      return connection;
    }
    return { root, url, port, certPath, keyPath, certificate, client, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Evidence is outside the app; no private keys, tokens, connection URLs or fixture data are written. */
export async function recordNativeEvidence(name: string, value: unknown) {
  const base = resolve(process.env.CHAT_NATIVE_WORK_DIR!);
  await writeFile(join(base, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
}

export async function until(check: () => Promise<boolean>, label: string, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

/** Hold a real transaction advisory lock, and prove a competing backend is waiting before releasing it. */
export async function advisoryBarrier(blocker: postgres.Sql, observer: postgres.Sql, key: string) {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transaction = blocker.begin(async (tx) => {
    await tx`set local lock_timeout='5s'`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${key},0))`;
    enter();
    await released;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      entered,
      transaction.then(() => {
        throw new Error('Barrier transaction ended before acquisition.');
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Barrier acquisition timed out.')), 10000);
      }),
    ]);
  } catch (error) {
    release();
    void transaction.catch(() => {});
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
  return {
    async waitForBlocked(expectedPids: number[]) {
      await until(
        async () =>
          Number(
            (
              await observer`select count(distinct pid)::int as count from pg_locks where pid=any(${expectedPids}::int[]) and locktype='advisory' and not granted`
            )[0].count,
          ) === expectedPids.length,
        key,
      );
    },
    async release() {
      release();
      await transaction;
    },
  };
}

export function spawnNext(port: number, env: NodeJS.ProcessEnv) {
  const child = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
    { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let diagnostics = '';
  const collect = (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-4000);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  return { child, diagnostics: () => diagnostics };
}

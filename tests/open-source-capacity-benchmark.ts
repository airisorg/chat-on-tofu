// Opt-in disposable native benchmark. It never connects to managed services.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type postgres from 'postgres';
import type * as Server from '../src/lib/server';
import { fixtureUser, nativeCluster } from './helpers/native-postgres';
const source = process.env.CHAT_AUDIT_SERVER_SOURCE!;
const out = process.env.CHAT_AUDIT_BENCH_OUTPUT!;
function observed(connection: postgres.Sql, counted: { value: number }) {
  return new Proxy(connection, {
    get(target, property) {
      if (property === 'begin')
        return async (work: (tx: postgres.TransactionSql) => Promise<unknown>) =>
          target.begin((tx) =>
            work(
              new Proxy(tx, {
                apply(tag, receiver, args) {
                  counted.value++;
                  return Reflect.apply(tag, receiver, args);
                },
              }),
            ),
          );
      return Reflect.get(target, property);
    },
  });
}
async function main() {
  assert.ok(source && out, 'Explicit local source/evidence paths required.');
  const server = (await import(pathToFileURL(source).href)) as typeof Server;
  const fixture = await nativeCluster('capacity-benchmark');
  const rows: unknown[] = [];
  try {
    const admin = fixture.client();
    await server.applySchema(admin);
    for (const members of [10, 30]) {
      const people = Array.from({ length: members }, (_, index) =>
        fixtureUser(`budget-${members}-${index}`),
      );
      for (const account of people) await server.getChat(account, admin);
      const owner = people[0],
        group = (
          await server.mutateChat(
            owner,
            {
              type: 'create',
              kind: 'group',
              name: 'Guard benchmark',
              emails: people.slice(1).map((person) => person.email!),
            },
            admin,
          )
        ).id!;
      for (const account of people.slice(1)) await server.getChat(account, admin);
      const count = { value: 0 },
        sql = observed(fixture.client(), count);
      for (const action of ['sync', 'send', 'profile', 'create', 'invite', 'claim'] as const) {
        const samples: { ms: number; queries: number }[] = [];
        const guests = Array.from({ length: 7 }, (_, index) =>
          fixtureUser(`guest-${members}-${action}-${index}`),
        );
        for (const guest of guests) await server.getChat(guest, admin);
        for (let index = 0; index < 7; index++) {
          const conversationId =
            action === 'invite' || action === 'claim'
              ? (
                  await server.mutateChat(
                    owner,
                    {
                      type: 'create',
                      kind: 'group',
                      name: 'Invite target',
                      emails: [
                        ...people.slice(1, -1).map((person) => person.email!),
                        ...(action === 'claim' ? [guests[index].email!] : []),
                      ],
                    },
                    admin,
                  )
                ).id!
              : group;
          if (action === 'invite' || action === 'claim')
            for (const account of people.slice(1, -1)) await server.getChat(account, admin);
          const payload =
            action === 'send'
              ? {
                  type: action,
                  conversationId,
                  text: `Measured ${index}`,
                  clientMessageId: crypto.randomUUID(),
                }
              : action === 'profile'
                ? { type: action, status: `Measured ${index}` }
                : action === 'create'
                  ? {
                      type: action,
                      kind: 'group',
                      name: `Measured ${index}`,
                      emails: people.slice(1).map((person) => person.email!),
                    }
                  : { type: action, conversationId, emails: [guests[index].email!] };
          count.value = 0;
          const started = performance.now();
          const account = action === 'claim' ? guests[index] : owner;
          const state =
            action === 'sync' || action === 'claim'
              ? await server.getChat(account, sql)
              : (await server.mutateChat(owner, payload, sql)).state;
          const elapsed = performance.now() - started;
          assert.ok(state.user.id === account.id);
          if (index >= 2) samples.push({ ms: elapsed, queries: count.value });
        }
        const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
        rows.push({
          members,
          action,
          samples,
          p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
          p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
        });
      }
    }
  } finally {
    await fixture.close();
  }
  await writeFile(
    out,
    JSON.stringify(
      {
        scope:
          'Actual production functions, native PostgreSQL over verified synthetic TLS, serial disposable fixtures. Five measured samples after two warmups; nearest-rank p50/p95 (p95 is the observed maximum). Application-statement counts exclude driver BEGIN/COMMIT; timers include the transaction. Excludes HTTP/authentication/provider/rate quota. Each source uses a separate identically constructed cluster; a diagnostic comparison, not production load.',
        sourceSha256: createHash('sha256')
          .update(await readFile(source))
          .digest('hex'),
        rows,
        cleanup: 'owned cluster stopped and removed before evidence write',
      },
      null,
      2,
    ) + '\n',
  );
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.name + ': ' + error.message : 'Benchmark failed');
  process.exitCode = 1;
});

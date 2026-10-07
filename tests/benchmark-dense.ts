import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import { applySchema, getChat, mutateChat } from '../src/lib/server';
import { sqlAdapter } from './helpers/pglite-sql';

async function main() {
  const stage = process.argv[2] || 'baseline',
    rows = [];
  for (const people of [10, 30]) {
    const pg = new PGlite(),
      sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
    try {
      await applySchema(sql);
      const users: User[] = Array.from({ length: people }, (_, index) => ({
        id: crypto.randomUUID(),
        email: `dense-${index}@benchmark.invalid`,
        email_confirmed_at: new Date().toISOString(),
        aud: 'authenticated',
        app_metadata: {},
        user_metadata: { full_name: `Dense ${index}` },
        created_at: new Date().toISOString(),
      }));
      for (const user of users) await getChat(user, sql);
      const id = (
        await mutateChat(
          users[0],
          {
            type: 'create',
            kind: 'group',
            name: 'Dense reactions',
            emails: users.slice(1).map((user) => user.email),
          },
          sql,
        )
      ).id!;
      for (const user of users.slice(1)) await getChat(user, sql);
      if (
        Number(
          (
            await pg.query<{ count: number }>(
              'select count(*)::int as count from relay.participants where conversation_id=$1',
              [id],
            )
          ).rows[0].count,
        ) !== people
      )
        throw new Error('Dense reaction fixtures require all intended verified members.');
      await pg.query(
        "insert into relay.messages(id,conversation_id,author_id,text,created_at) select gen_random_uuid(),$1,$2,'Dense '||number,now()-number*interval '1 second' from generate_series(1,2000) number",
        [id, users[0].id],
      );
      await pg.query(
        "insert into relay.reactions(message_id,user_id,emoji) select m.id,p.user_id,'👍' from relay.messages m join relay.participants p on p.conversation_id=m.conversation_id where m.conversation_id=$1",
        [id],
      );
      await pg.exec('ANALYZE relay.messages; ANALYZE relay.reactions;');
      const samples = [];
      let bytes = 0,
        returnedMessages = 0;
      for (let index = -1; index < 5; index++) {
        const start = performance.now();
        const state = await getChat(users[0], sql);
        const duration = performance.now() - start;
        bytes = Buffer.byteLength(JSON.stringify(state));
        returnedMessages = state.messages.length;
        if (index >= 0) samples.push(duration);
      }
      const installed = (
        await pg.query<{ version: number }>(
          'select max(version)::int as version from relay.schema_migrations',
        )
      ).rows[0].version;
      const sorted = [...samples].sort((a, b) => a - b);
      rows.push({
        people,
        installedSchemaVersion: installed,
        messages: 2000,
        returnedMessages,
        reactions: people * 2000,
        samples: 5,
        medianMs: Math.round(sorted[2] * 100) / 100,
        p95Ms: Math.round(sorted[4] * 100) / 100,
        responseBytes: bytes,
        measurementsMs: samples,
      });
      console.log(JSON.stringify(rows.at(-1)));
    } finally {
      await pg.close();
    }
  }
  const directory = process.env.CHAT_EVIDENCE_DIR
    ? resolve(process.env.CHAT_EVIDENCE_DIR)
    : resolve('test-results/group-performance');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, `${stage}-dense.json`),
    JSON.stringify(
      {
        scope:
          'Disposable local SQL and JavaScript server materialization, including internal serialized-payload budgeting; excludes final HTTP serialization, auth verification, per-request quota enforcement, network/upload transfer, browser, hosting and multi-connection load.',
        rows,
      },
      null,
      2,
    ) + '\n',
  );
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Dense benchmark failed');
  process.exitCode = 1;
});

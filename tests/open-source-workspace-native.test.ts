import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { applySchema, ChatError, getChat, mutateChat } from '../src/lib/server';
import { MAX_HISTORY_PAYLOAD_BYTES } from '../src/lib/media-limits';
import {
  fixtureUser,
  nativeCluster,
  nativeEnabled,
  nativeSkip,
  recordNativeEvidence,
  until,
} from './helpers/native-postgres';

const reservedBytes = (state: Awaited<ReturnType<typeof getChat>>) => {
  const { avatar: _avatar, ...user } = state.user;
  return Buffer.byteLength(
    JSON.stringify({
      user: { ...user, email: '\u0001'.repeat(254) },
      messages: [],
      conversations: state.conversations.map((c) => ({
        ...c,
        lastMessage: 'Preview unavailable',
        unread: 2147483647,
        section: '\u0001'.repeat(40),
        pinned: false,
        muted: false,
        members: c.members.map(({ avatar: _avatar, ...member }) => ({
          ...member,
          email: '\u0001'.repeat(254),
        })),
      })),
    }),
  );
};

test(
  'opt-in native recipient metadata admission serializes distinct simultaneous shared profile expansions',
  { skip: nativeEnabled ? false : nativeSkip, timeout: 60000 },
  async () => {
    const fixture = await nativeCluster('workspace-admission');
    const started = Date.now();
    let proof: Record<string, unknown> | undefined;
    try {
      const admin = fixture.client(),
        one = fixture.client(),
        two = fixture.client(),
        blocker = fixture.client(),
        observer = fixture.client();
      const connections = [admin, one, two, blocker, observer];
      const pids = await Promise.all(
        connections.map(async (sql) => Number((await sql`select pg_backend_pid() as pid`)[0].pid)),
      );
      assert.equal(new Set(pids).size, 5);
      await applySchema(admin);
      const victim = fixtureUser('shared-recipient'),
        owners = [fixtureUser('initiator-a'), fixtureUser('initiator-b')];
      for (const account of [victim, ...owners]) {
        await getChat(account, admin);
      }
      for (const owner of owners) {
        await mutateChat(
          owner,
          {
            type: 'create',
            kind: 'group',
            name: 'Existing shared membership',
            emails: [victim.email!],
          },
          admin,
        );
        await getChat(victim, admin);
      }
      await admin`delete from relay.events`;
      await admin`update relay.profiles set name=${'\u0001'.repeat(80)},status=${'\u0001'.repeat(80)} where id=${victim.id}`;
      const profile = { ...(await getChat(victim, admin)).user, email: '\u0001'.repeat(254) };
      const sample = {
        id: crypto.randomUUID(),
        name: 'Private',
        kind: 'space',
        members: [profile],
        description: '',
        lastMessage: 'Preview unavailable',
        updatedAt: new Date().toISOString(),
        unread: 2147483647,
        pinned: false,
        muted: false,
        section: '\u0001'.repeat(40),
      };
      const target = MAX_HISTORY_PAYLOAD_BYTES - 1024 - 1200;
      const count = Math.floor(
        (target - reservedBytes(await getChat(victim, admin))) /
          (Buffer.byteLength(JSON.stringify(sample)) + 1),
      );
      const inserted =
        await admin`with added as (insert into relay.conversations(id,name,kind,creator_id) select gen_random_uuid(),'Private','space',${victim.id} from generate_series(1,${count}) returning id), members as (insert into relay.participants(conversation_id,user_id) select id,${victim.id} from added) select id from added`;
      let remaining = target - reservedBytes(await getChat(victim, admin));
      assert.ok(remaining >= 0);
      for (const row of inserted) {
        if (!remaining) break;
        const contribution = Math.min(remaining, 473),
          nameBytes = 7 + contribution;
        await admin`update relay.conversations set name=${'\u0001'.repeat(Math.floor(nameBytes / 6)) + 'x'.repeat(nameBytes % 6)} where id=${row.id}`;
        remaining -= contribution;
      }
      assert.equal(reservedBytes(await getChat(victim, admin)), target);
      let enter!: () => void, release!: () => void;
      const ready = new Promise<void>((resolve) => {
          enter = resolve;
        }),
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      const holding = blocker.begin(async (tx) => {
        await tx`set local lock_timeout='5s'`;
        await tx`select id from relay.profiles where id=${victim.id} for no key update`;
        enter();
        await gate;
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          ready,
          holding.then(() => {
            throw new Error('Recipient gate ended before acquisition.');
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Recipient gate acquisition timed out.')),
              10000,
            );
          }),
        ]);
      } catch (error) {
        release();
        await holding.catch(() => {});
        throw error;
      } finally {
        clearTimeout(timer);
      }
      const actions = owners.map((owner) => ({
        type: 'profile',
        name: '\u0001'.repeat(80),
        status: '\u0001'.repeat(80),
        clientActionId: crypto.randomUUID(),
        clientActionCreatedAt: new Date().toISOString(),
        owner,
      }));
      const mutations = actions.map((entry, index) => {
        const { owner, ...action } = entry;
        return mutateChat(owner, action, index ? two : one);
      });
      const settled = Promise.allSettled(mutations);
      try {
        // PostgreSQL may queue the second waiter on the first waiter's tuple lock
        // rather than list the held transaction directly. Both exact request PIDs
        // must be in this guard and have a blocker chain reaching the held recipient.
        await until(
          async () =>
            Number(
              (
                await observer`with recursive wait_chain(request_id,blocking_id) as (
        select pid,unnest(pg_blocking_pids(pid)) from pg_stat_activity
          where pid=any(${[pids[1], pids[2]]}::int[]) and query like '%for no key update%'
        union
        select request_id,unnest(pg_blocking_pids(blocking_id)) from wait_chain
      ) select count(distinct request_id)::int as count from wait_chain where blocking_id=${pids[3]}`
              )[0].count,
            ) === 2,
          'both identified admission guards blocked through the held recipient profile',
        );
      } catch (error) {
        // Sanitized test-only lock diagnostics: no parameter values or URLs.
        console.error(
          await observer`select pid,wait_event,pg_blocking_pids(pid) as blockers,left(query,100) as statement from pg_stat_activity where pid=any(${[pids[1], pids[2]]}::int[])`,
        );
        throw error;
      } finally {
        release();
        try {
          await holding;
        } finally {
          await settled;
        }
      }
      const results = await settled;
      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
        'only one expansion fits the recipient reserve',
      );
      const rejected = results.find((result) => result.status === 'rejected');
      assert.ok(
        rejected &&
          rejected.status === 'rejected' &&
          rejected.reason instanceof ChatError &&
          rejected.reason.status === 400,
      );
      const state = await getChat(victim, admin);
      assert.equal(state.conversations.length, count + 2);
      assert.ok(reservedBytes(state) <= MAX_HISTORY_PAYLOAD_BYTES - 1024);
      const totals = (
        await admin`select (select count(*)::int from relay.operations where id=any(${actions.map((action) => action.clientActionId)}::uuid[])) as receipts,(select count(*)::int from relay.events) as events,(select count(*)::int from relay.profiles where id=any(${owners.map((owner) => owner.id)}::text[]) and name=${'\u0001'.repeat(80)}) as profiles`
      )[0];
      assert.deepEqual(
        {
          receipts: Number(totals.receipts),
          events: Number(totals.events),
          profiles: Number(totals.profiles),
        },
        { receipts: 1, events: 2, profiles: 1 },
      );
      const failedIndex = results.findIndex((result) => result.status === 'rejected'),
        { owner, ...retry } = actions[failedIndex];
      await assert.rejects(
        mutateChat(owner, retry, one),
        (error) => error instanceof ChatError && error.status === 400,
        'refused retry remains uncommitted',
      );
      assert.equal(
        Number((await admin`select count(*)::int as count from relay.events`)[0].count),
        2,
      );
      proof = {
        scope:
          'Five independent native PostgreSQL connections over verified synthetic TLS; actual server functions and deterministic recipient-row barrier. No HTTP, managed service, real accounts or provider credentials.',
        fixture:
          'one capacity-constrained recipient and two distinct authorized existing members expanding their shared profile metadata',
        barrier:
          'both exact request PIDs observed in FOR NO KEY UPDATE guards with blocker chains reaching the held recipient PID; PostgreSQL may queue a waiter behind the other waiter',
        results: { committed: 1, capacityRefused: 1, receipts: 1, events: 2, profiles: 1 },
        retry: 'refused action retry commits no receipt or event',
        elapsedMs: Date.now() - started,
        sourceSha256: createHash('sha256')
          .update(await readFile('src/lib/server.ts'))
          .digest('hex'),
        testSha256: createHash('sha256')
          .update(await readFile('tests/open-source-workspace-native.test.ts'))
          .digest('hex'),
      };
    } finally {
      await fixture.close();
    }
    await recordNativeEvidence('workspace-admission', {
      ...proof,
      cleanup: 'owned disposable cluster stopped and removed before evidence write',
    });
  },
);

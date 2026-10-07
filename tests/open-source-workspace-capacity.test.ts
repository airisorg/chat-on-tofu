import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import * as candidate from '../src/lib/server';
import { MAX_HISTORY_PAYLOAD_BYTES } from '../src/lib/media-limits';
import { sqlAdapter } from './helpers/pglite-sql';

// An explicit immutable source override permits the identical regression to
// challenge the released baseline without changing either application tree.
const functions = process.env.CHAT_AUDIT_SERVER_SOURCE
  ? (import(pathToFileURL(process.env.CHAT_AUDIT_SERVER_SOURCE).href) as Promise<typeof candidate>)
  : Promise.resolve(candidate);
const limit = MAX_HISTORY_PAYLOAD_BYTES - 1024;
const identity = (label: string, large = false): User => ({
  id: crypto.randomUUID(),
  email: `${label}@capacity-test.invalid`,
  email_confirmed_at: '2026-10-05T00:00:00Z',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {
    name: label,
    ...(large ? { picture: `https://lh3.googleusercontent.com/${'a'.repeat(1900)}` } : {}),
  },
  created_at: '2026-10-05T00:00:00Z',
});
const metadataBytes = (state: Awaited<ReturnType<typeof candidate.getChat>>) =>
  Buffer.byteLength(JSON.stringify({ ...state, messages: [] }));

async function fixture() {
  const server = await functions;
  const pg = new PGlite(),
    bounds = new Map<string, number>();
  const observe = (engine: { query: typeof pg.query }) => ({
    query: async (query: string, parameters?: unknown[]) => {
      const result = await engine.query(query, parameters);
      if (query.includes('metadata_upper_bytes'))
        for (const row of result.rows as { id: string; metadata_upper_bytes: number }[])
          bounds.set(row.id, Number(row.metadata_upper_bytes));
      return result;
    },
  });
  const sql = sqlAdapter(observe(pg), (callback) => pg.transaction((tx) => callback(observe(tx))));
  await server.applySchema(sql);
  return { server, pg, sql, bounds };
}

// Legal legacy data is seeded directly to exercise a workspace that predates
// admission reserves. Normal API mutation/read functions perform every probe.
async function fillNearLimit(f: Awaited<ReturnType<typeof fixture>>, account: User, gap: number) {
  const target = limit - gap;
  await f.pg.query('update relay.profiles set name=$1,status=$1 where id=$2', [
    '\u0001'.repeat(80),
    account.id,
  ]);
  const before = await f.server.getChat(account, f.sql);
  const sample = {
    id: crypto.randomUUID(),
    name: 'Private',
    kind: 'space',
    members: [before.user],
    description: '',
    updatedAt: new Date().toISOString(),
    unread: 0,
    pinned: false,
    muted: false,
    section: '',
  };
  const count = Math.floor(
    (target - metadataBytes(before)) / (Buffer.byteLength(JSON.stringify(sample)) + 1),
  );
  assert.ok(count > 0);
  const inserted = (
    await f.pg.query<{ id: string }>(
      "with added as (insert into relay.conversations(id,name,kind,description,creator_id) select gen_random_uuid(),'Private','space','',$1 from generate_series(1,$2) returning id), members as (insert into relay.participants(conversation_id,user_id) select id,$1 from added) select id from added",
      [account.id, count],
    )
  ).rows;
  let state = await f.server.getChat(account, f.sql);
  let remaining = target - metadataBytes(state);
  assert.ok(remaining >= 0);
  for (const row of inserted) {
    if (!remaining) break;
    const contribution = Math.min(remaining, 240);
    const section = '\u0001'.repeat(Math.floor(contribution / 6)) + 'x'.repeat(contribution % 6);
    await f.pg.query(
      'update relay.participants set section=$1 where conversation_id=$2 and user_id=$3',
      [section, row.id, account.id],
    );
    remaining -= contribution;
  }
  state = await f.server.getChat(account, f.sql);
  assert.equal(
    metadataBytes(state),
    target,
    'fixture must actually be below the response bound, not already inaccessible',
  );
  return state;
}

const refused = (server: typeof candidate) => (error: unknown) =>
  error instanceof server.ChatError &&
  error.status === 400 &&
  /workspace too large/.test(error.message);
const receipt = () => ({
  clientActionId: crypto.randomUUID(),
  clientActionCreatedAt: new Date().toISOString(),
});

// The minimum projection still reserves future identity and personal controls.
// Optional avatar/preview removal must not make that margin spendable later.
const reservedMetadata = (state: Awaited<ReturnType<typeof candidate.getChat>>) => {
  const { avatar: _avatar, ...user } = state.user;
  return {
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
  };
};
async function fillReservedNearLimit(
  f: Awaited<ReturnType<typeof fixture>>,
  account: User,
  gap: number,
) {
  const target = limit - gap;
  await f.pg.query('update relay.profiles set name=$1,status=$1 where id=$2', [
    '\u0001'.repeat(80),
    account.id,
  ]);
  const before = await f.server.getChat(account, f.sql),
    reserved = reservedMetadata(before);
  const sample = {
    id: crypto.randomUUID(),
    name: 'Private',
    kind: 'space',
    members: [reserved.user],
    description: '',
    lastMessage: 'Preview unavailable',
    updatedAt: new Date().toISOString(),
    unread: 2147483647,
    pinned: false,
    muted: false,
    section: '\u0001'.repeat(40),
  };
  const count = Math.floor(
    (target - metadataBytes(reserved)) / (Buffer.byteLength(JSON.stringify(sample)) + 1),
  );
  const inserted = (
    await f.pg.query<{ id: string }>(
      "with added as (insert into relay.conversations(id,name,kind,creator_id) select gen_random_uuid(),'Private','space',$1 from generate_series(1,$2) returning id), members as (insert into relay.participants(conversation_id,user_id) select id,$1 from added) select id from added",
      [account.id, count],
    )
  ).rows;
  let remaining = target - metadataBytes(reservedMetadata(await f.server.getChat(account, f.sql)));
  assert.ok(remaining >= 0);
  for (const row of inserted) {
    if (!remaining) break;
    const contribution = Math.min(remaining, 473),
      nameBytes = 7 + contribution;
    await f.pg.query('update relay.conversations set name=$1 where id=$2', [
      '\u0001'.repeat(Math.floor(nameBytes / 6)) + 'x'.repeat(nameBytes % 6),
      row.id,
    ]);
    remaining -= contribution;
  }
  const state = await f.server.getChat(account, f.sql);
  assert.equal(metadataBytes(reservedMetadata(state)), target);
  assert.ok(
    metadataBytes(state) < target - 1000,
    'actual response alone must not conceal the reserved identity margin',
  );
}

for (const mode of ['profile', 'conversation'] as const)
  test(`later ${mode} writes cannot spend future identity or personal preference reserves`, async () => {
    const f = await fixture(),
      owner = identity(`reserve-${mode}-owner`),
      peer = identity(`reserve-${mode}-peer`);
    try {
      await f.server.getChat(owner, f.sql);
      await f.server.getChat(peer, f.sql);
      const conversationId = (
        await f.server.mutateChat(
          owner,
          { type: 'create', kind: 'group', name: 'Reserved', emails: [peer.email!] },
          f.sql,
        )
      ).id!;
      await fillReservedNearLimit(f, peer, 10);
      const state = await f.server.getChat(peer, f.sql),
        name = state.conversations.find((c) => c.id === conversationId)!.name;
      const action =
        mode === 'profile'
          ? { type: mode, name: '\u0001'.repeat(80) }
          : { type: mode, conversationId, name: '\u0001'.repeat(80) };
      await assert.rejects(f.server.mutateChat(owner, action, f.sql), refused(f.server));
      assert.equal(
        (await f.server.getChat(peer, f.sql)).conversations.find((c) => c.id === conversationId)!
          .name,
        name,
      );
      // These writes deliberately do not use shared profile locks. The admission
      // reservation covers their complete encoded values, including false booleans.
      await f.server.mutateChat(
        peer,
        {
          type: 'conversation',
          conversationId,
          section: '\u0001'.repeat(40),
          pinned: false,
          muted: false,
        },
        f.sql,
      );
      await f.server.mutateChat(peer, { type: 'read', conversationId, unread: true }, f.sql);
      const email = 'a'.repeat(254 - '@capacity-test.invalid'.length) + '@capacity-test.invalid';
      const changed = await f.server.getChat({ ...peer, email }, f.sql);
      assert.equal(changed.user.email, email);
      assert.ok(metadataBytes(changed) <= limit);
      assert.equal(changed.conversations.find((c) => c.id === conversationId)?.section?.length, 40);
    } finally {
      await f.pg.close();
    }
  });

for (const type of ['create', 'invite'] as const)
  test(`recipient capacity refuses a verified ${type} claim without disturbing its committed invitation`, async () => {
    const f = await fixture(),
      owner = identity(`${type}-owner`),
      victim = identity(`${type}-victim`),
      peers = Array.from({ length: 28 }, (_, i) => identity(`${type}-${i}`, true));
    try {
      for (const account of [owner, victim, ...peers]) await f.server.getChat(account, f.sql);
      const group =
        type === 'invite'
          ? (
              await f.server.mutateChat(
                owner,
                {
                  type: 'create',
                  kind: 'group',
                  name: 'Existing group',
                  emails: peers.map((peer) => peer.email!),
                },
                f.sql,
              )
            ).id!
          : undefined;
      await fillNearLimit(f, victim, 3000);
      const retry = receipt();
      const action =
        type === 'create'
          ? {
              type,
              name: 'Otherwise valid',
              kind: 'group',
              emails: [victim.email!, ...peers.map((peer) => peer.email!)],
              ...retry,
            }
          : { type, conversationId: group!, emails: [victim.email!], ...retry };
      const target = (await f.server.mutateChat(owner, action, f.sql)).id ?? group!;
      const before = (
        await f.pg.query(
          'select (select count(*)::int from relay.participants) as participants,(select count(*)::int from relay.events) as events,(select count(*)::int from relay.conversations) as conversations',
        )
      ).rows[0];
      const state = await f.server.getChat(victim, f.sql);
      assert.equal(
        state.conversations.some((c) => c.id === target),
        false,
      );
      assert.deepEqual(
        (
          await f.pg.query(
            'select (select count(*)::int from relay.participants) as participants,(select count(*)::int from relay.events) as events,(select count(*)::int from relay.conversations) as conversations',
          )
        ).rows[0],
        before,
      );
      assert.equal(
        (await f.pg.query('select id from relay.operations where id=$1', [retry.clientActionId]))
          .rows.length,
        1,
        'only the already-committed invitation has a receipt',
      );
      assert.equal(
        (
          await f.pg.query(
            'select email from relay.invites where conversation_id=$1 and email=$2',
            [target, victim.email],
          )
        ).rows.length,
        1,
        'capacity-refused claims remain pending',
      );
      await f.server.mutateChat(owner, action, f.sql);
      assert.deepEqual(
        (
          await f.pg.query(
            'select (select count(*)::int from relay.participants) as participants,(select count(*)::int from relay.events) as events,(select count(*)::int from relay.conversations) as conversations',
          )
        ).rows[0],
        before,
        'invitation replay does not duplicate committed effects',
      );
      assert.ok(metadataBytes(await f.server.getChat(victim, f.sql)) < limit);
    } finally {
      await f.pg.close();
    }
  });

test('automatic claims preserve usable sign-in and other admitted groups when a peer would overflow', async () => {
  const f = await fixture(),
    owner = identity('pending-owner'),
    victim = identity('pending-victim'),
    joining = identity('pending-new', true);
  try {
    await f.server.getChat(owner, f.sql);
    await f.server.getChat(victim, f.sql);
    const conversationId = (
      await f.server.mutateChat(
        owner,
        {
          type: 'create',
          kind: 'group',
          name: 'Pending claim',
          emails: [victim.email!, joining.email!],
        },
        f.sql,
      )
    ).id!;
    const admitted = (
      await f.server.mutateChat(
        owner,
        { type: 'create', kind: 'group', name: 'Admitted independently', emails: [joining.email!] },
        f.sql,
      )
    ).id!;
    await fillNearLimit(f, victim, 500);
    const signedIn = await f.server.getChat(joining, f.sql);
    assert.equal(signedIn.user.id, joining.id);
    assert.deepEqual(
      signedIn.conversations.map((c) => c.id),
      [admitted],
    );
    assert.equal(
      (await f.pg.query('select id from relay.profiles where id=$1', [joining.id])).rows.length,
      1,
    );
    assert.equal(
      (
        await f.pg.query(
          'select user_id from relay.participants where user_id=$1 and conversation_id=$2',
          [joining.id, conversationId],
        )
      ).rows.length,
      0,
    );
    assert.deepEqual(
      (await f.server.getChat(joining, f.sql)).conversations.map((c) => c.id),
      [admitted],
      'repeated polling remains usable while the refused invitation stays pending',
    );
    assert.equal(
      (
        await f.pg.query('select email from relay.invites where conversation_id=$1 and email=$2', [
          conversationId,
          joining.email,
        ])
      ).rows.length,
      1,
    );
    assert.ok(metadataBytes(await f.server.getChat(victim, f.sql)) < limit);
  } finally {
    await f.pg.close();
  }
});

for (const mode of ['profile', 'conversation'] as const)
  test(`shared ${mode} changes cannot poison another member's valid workspace`, async () => {
    const f = await fixture(),
      owner = identity(`${mode}-owner`),
      victim = identity(`${mode}-victim`);
    try {
      await f.server.getChat(owner, f.sql);
      await f.server.getChat(victim, f.sql);
      const conversationId = (
        await f.server.mutateChat(
          owner,
          { type: 'create', kind: 'group', name: 'Shared', emails: [victim.email!] },
          f.sql,
        )
      ).id!;
      await fillNearLimit(f, victim, 10);
      const original = (await f.pg.query('select * from relay.profiles where id=$1', [owner.id]))
        .rows[0];
      const conversation = (
        await f.pg.query('select name,description from relay.conversations where id=$1', [
          conversationId,
        ])
      ).rows[0];
      const eventCount = (await f.pg.query('select count(*)::int as count from relay.events'))
        .rows[0];
      if (mode === 'profile')
        await assert.rejects(
          f.server.mutateChat(
            owner,
            { type: 'profile', name: '\u0001'.repeat(80), status: '\u0002'.repeat(80) },
            f.sql,
          ),
          refused(f.server),
        );
      if (mode === 'conversation')
        await assert.rejects(
          f.server.mutateChat(
            owner,
            {
              type: 'conversation',
              conversationId,
              name: '\u0001'.repeat(80),
              description: '\u0001'.repeat(500),
            },
            f.sql,
          ),
          refused(f.server),
        );
      assert.deepEqual(
        (await f.pg.query('select * from relay.profiles where id=$1', [owner.id])).rows[0],
        original,
      );
      assert.deepEqual(
        (
          await f.pg.query('select name,description from relay.conversations where id=$1', [
            conversationId,
          ])
        ).rows[0],
        conversation,
      );
      assert.deepEqual(
        (await f.pg.query('select count(*)::int as count from relay.events')).rows[0],
        eventCount,
      );
      assert.ok(metadataBytes(await f.server.getChat(victim, f.sql)) < limit);
    } finally {
      await f.pg.close();
    }
  });

test('bounded previews preserve full content and retry identity in an admitted workspace', async () => {
  const f = await fixture(),
    owner = identity('preview-owner'),
    victim = identity('preview-victim');
  try {
    await f.server.getChat(owner, f.sql);
    await f.server.getChat(victim, f.sql);
    const conversationId = (
      await f.server.mutateChat(
        owner,
        { type: 'create', kind: 'group', name: 'Preview', emails: [victim.email!] },
        f.sql,
      )
    ).id!;
    // Normal admitted workspaces retain full text and a bounded preview.
    // Near-limit legacy workspaces cannot spend the newly reserved identity margin.
    const clientMessageId = crypto.randomUUID(),
      text = '\u0001'.repeat(6000);
    const sent = await f.server.mutateChat(
      owner,
      { type: 'send', conversationId, text, clientMessageId },
      f.sql,
    );
    assert.equal(sent.state.messages.find((m) => m.id === clientMessageId)?.text.length, 6000);
    assert.equal(
      sent.state.conversations.find((c) => c.id === conversationId)?.lastMessage?.length,
      200,
    );
    assert.equal(
      (
        await f.pg.query<{ text: string }>('select text from relay.messages where id=$1', [
          clientMessageId,
        ])
      ).rows[0].text,
      text,
    );
    const peerState = await f.server.getChat(victim, f.sql);
    assert.ok(metadataBytes(peerState) <= limit);
    assert.equal(
      peerState.conversations.find((c) => c.id === conversationId)?.lastMessage?.length,
      200,
    );
    const replay = await f.server.mutateChat(
      owner,
      { type: 'send', conversationId, text, clientMessageId },
      f.sql,
    );
    assert.equal(replay.id, clientMessageId);
    assert.equal(
      (await f.pg.query('select id from relay.messages where id=$1', [clientMessageId])).rows
        .length,
      1,
    );
  } finally {
    await f.pg.close();
  }
});

test('common-write SQL upper bounds dominate actual escaped Unicode DTOs and reserved previews', async () => {
  const f = await fixture(),
    owner = identity('bound-owner'),
    peer = identity('bound-peer');
  try {
    await f.server.getChat(owner, f.sql);
    await f.server.getChat(peer, f.sql);
    const group = (
      await f.server.mutateChat(
        owner,
        {
          type: 'create',
          kind: 'group',
          name: 'Bounds',
          emails: [peer.email!, 'pending@example.invalid'],
        },
        f.sql,
      )
    ).id!;
    await f.server.getChat(peer, f.sql);
    for (const text of ['ASCII', '\u0001\u001f', '"\\', '😀🧑🏽‍💻', '漢字\u2028é', 'a'.repeat(80)]) {
      const name = text.repeat(Math.max(1, Math.floor(80 / text.length))).slice(0, 80);
      const avatar = `https://lh3.googleusercontent.com/${encodeURIComponent(text)}/${text}`;
      await f.pg.query(
        'update relay.profiles set name=$1,status=$1,avatar=$2 where id=any($3::text[])',
        [name, avatar, [owner.id, peer.id]],
      );
      await f.pg.query('update relay.conversations set description=$1 where id=$2', [
        name.repeat(6).slice(0, 500),
        group,
      ]);
      f.bounds.clear();
      await f.server.mutateChat(
        owner,
        {
          type: 'send',
          conversationId: group,
          text: name.repeat(2),
          clientMessageId: crypto.randomUUID(),
        },
        f.sql,
      );
      for (const account of [owner, peer]) {
        const state = await f.server.getChat(account, f.sql);
        const actual = metadataBytes(state);
        const reserved = metadataBytes({
          ...state,
          user: { ...state.user, email: '\u0001'.repeat(254) },
          conversations: state.conversations.map((c) => ({
            ...c,
            lastMessage: '\u0001'.repeat(200),
            unread: 2147483647,
            section: '\u0001'.repeat(40),
            pinned: false,
            muted: false,
            members: c.members.map((member) => ({ ...member, email: '\u0001'.repeat(254) })),
          })),
        });
        assert.ok(
          f.bounds.has(account.id),
          'the actual production upper-bound query must cover both recipients',
        );
        assert.ok(
          f.bounds.get(account.id)! >= Math.max(actual, reserved),
          `upper bound must cover every DTO field and JSON escaping for ${JSON.stringify(text)}`,
        );
      }
    }
  } finally {
    await f.pg.close();
  }
});

test('no-avatar presentation compaction preserves editable descriptions and authoritative email', async () => {
  const f = await fixture(),
    owner = identity('compact-owner'),
    victim = identity('compact-victim');
  try {
    await f.server.getChat(owner, f.sql);
    await f.server.getChat(victim, f.sql);
    const description = 'Stored description must remain editable';
    const conversationId = (
      await f.server.mutateChat(
        owner,
        { type: 'create', kind: 'group', name: 'Compaction', description, emails: [victim.email!] },
        f.sql,
      )
    ).id!;
    await f.server.mutateChat(
      owner,
      { type: 'send', conversationId, text: '\u0001'.repeat(200) },
      f.sql,
    );
    await fillNearLimit(f, victim, 10);
    const email = 'a'.repeat(254 - '@capacity-test.invalid'.length) + '@capacity-test.invalid';
    const beforeEvents = (await f.pg.query('select count(*)::int as count from relay.events'))
      .rows[0];
    const changed = await f.server.getChat({ ...owner, email }, f.sql);
    assert.equal(changed.user.email, email);
    assert.equal(
      (
        await f.pg.query<{ email: string }>('select email from relay.profiles where id=$1', [
          owner.id,
        ])
      ).rows[0].email,
      email,
    );
    const compact = await f.server.getChat(victim, f.sql),
      group = compact.conversations.find((c) => c.id === conversationId)!;
    assert.ok(metadataBytes(compact) <= limit);
    assert.equal(group.lastMessage, 'Preview unavailable');
    assert.equal(
      group.description,
      description,
      'editable metadata must never be silently blanked by presentation compaction',
    );
    assert.equal(group.members.find((member) => member.id === owner.id)?.email, email);
    assert.equal(compact.user.avatar, undefined);
    assert.ok(group.members.every((member) => member.avatar === undefined));
    assert.deepEqual(
      (await f.pg.query('select count(*)::int as count from relay.events')).rows[0],
      beforeEvents,
      'identity synchronization emits no unrelated events',
    );
    // This legacy workspace cannot fund future identity reserves; refuse the
    // shared rename cleanly without ever blanking its editable description.
    await assert.rejects(
      f.server.mutateChat(
        { ...owner, email },
        { type: 'conversation', conversationId, name: 'Renamed', description: group.description },
        f.sql,
      ),
      refused(f.server),
    );
    assert.equal(
      (
        await f.pg.query<{ description: string }>(
          'select description from relay.conversations where id=$1',
          [conversationId],
        )
      ).rows[0].description,
      description,
    );
  } finally {
    await f.pg.close();
  }
});

test('authoritative email survives a rejected action, rejects duplicate ownership and enforces the auth bound', async () => {
  const f = await fixture(),
    owner = identity('identity-owner'),
    peer = identity('identity-peer');
  try {
    await f.server.getChat(owner, f.sql);
    await f.server.getChat(peer, f.sql);
    const email = 'new-verified@capacity-test.invalid',
      retry = receipt();
    await assert.rejects(
      f.server.mutateChat(
        { ...owner, email },
        { type: 'profile', name: 'x'.repeat(81), ...retry },
        f.sql,
      ),
      (error) => error instanceof f.server.ChatError && error.status === 400,
    );
    assert.equal(
      (
        await f.pg.query<{ email: string }>('select email from relay.profiles where id=$1', [
          owner.id,
        ])
      ).rows[0].email,
      email,
      'failed workspace/action work cannot retain a stale email mapping',
    );
    assert.equal(
      (await f.pg.query('select id from relay.operations where id=$1', [retry.clientActionId])).rows
        .length,
      0,
    );
    await assert.rejects(
      f.server.getChat({ ...owner, email: peer.email }, f.sql),
      (error) => error instanceof f.server.ChatError && error.status === 409,
    );
    assert.equal(
      (
        await f.pg.query<{ email: string }>('select email from relay.profiles where id=$1', [
          owner.id,
        ])
      ).rows[0].email,
      email,
    );
    assert.equal((await f.server.getChat(peer, f.sql)).user.id, peer.id);
    await assert.rejects(
      f.server.getChat({ ...owner, email: 'a'.repeat(255) + '@test.invalid' }, f.sql),
      (error) => error instanceof f.server.ChatError && error.status === 403,
    );
    assert.equal((await f.pg.query('select id from relay.events')).rows.length, 0);
  } finally {
    await f.pg.close();
  }
});

test('legacy minimum-overcapacity leave commits despite an ambiguous503 and its receipt prevents replay', async () => {
  const f = await fixture(),
    owner = identity('legacy-recovery');
  try {
    await f.server.getChat(owner, f.sql);
    await fillNearLimit(f, owner, 1);
    const extra = (
      await f.pg.query<{ id: string }>(
        "with added as (insert into relay.conversations(id,name,kind,creator_id) select gen_random_uuid(),'Extra','space',$1 from generate_series(1,3) returning id), members as(insert into relay.participants(conversation_id,user_id) select id,$1 from added) select id from added",
        [owner.id],
      )
    ).rows;
    await assert.rejects(
      f.server.getChat(owner, f.sql),
      (error) =>
        error instanceof f.server.ChatError &&
        error.status === 503 &&
        /legacy workspace/.test(error.message),
    );
    const retry = receipt(),
      action = { type: 'leave', conversationId: extra[0].id, ...retry };
    await assert.rejects(
      f.server.mutateChat(owner, action, f.sql),
      (error) => error instanceof f.server.ChatError && error.status === 503,
    );
    assert.equal(
      (
        await f.pg.query(
          'select user_id from relay.participants where user_id=$1 and conversation_id=$2',
          [owner.id, extra[0].id],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await f.pg.query('select id from relay.operations where id=$1', [retry.clientActionId])).rows
        .length,
      1,
    );
    await assert.rejects(
      f.server.mutateChat(owner, action, f.sql),
      (error) => error instanceof f.server.ChatError && error.status === 503,
    );
    assert.equal(
      (await f.pg.query('select id from relay.operations where id=$1', [retry.clientActionId])).rows
        .length,
      1,
    );
    for (const row of extra.slice(1)) {
      try {
        await f.server.mutateChat(
          owner,
          { type: 'leave', conversationId: row.id, ...receipt() },
          f.sql,
        );
      } catch (error) {
        assert.ok(error instanceof f.server.ChatError && error.status === 503);
      }
    }
    assert.ok(metadataBytes(await f.server.getChat(owner, f.sql)) <= limit);
  } finally {
    await f.pg.close();
  }
});

test('ten refused invitations cannot starve an eleventh admissible group across routed reads', async () => {
  const f = await fixture(),
    inviter = identity('fair-inviter'),
    victim = identity('fair-victim'),
    joining = identity('fair-joining');
  try {
    await f.server.getChat(inviter, f.sql);
    await f.server.getChat(victim, f.sql);
    const ids = Array.from(
      { length: 11 },
      (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    );
    for (const [index, id] of ids.entries()) {
      await f.pg.query(
        "insert into relay.conversations(id,name,kind,creator_id) values($1,$2,'group',$3)",
        [id, `Pending ${index}`, inviter.id],
      );
      await f.pg.query('insert into relay.participants(conversation_id,user_id) values($1,$2)', [
        id,
        inviter.id,
      ]);
      if (index < 10)
        await f.pg.query('insert into relay.participants(conversation_id,user_id) values($1,$2)', [
          id,
          victim.id,
        ]);
      await f.pg.query('insert into relay.invites(conversation_id,email) values($1,$2)', [
        id,
        joining.email,
      ]);
    }
    await fillNearLimit(f, victim, 1);
    let admitted = false;
    for (let index = 0; index < 3; index++) {
      await f.server.enforceRequestLimit(joining, 'read', f.sql);
      const state = await f.server.getChat(joining, f.sql);
      admitted ||= state.conversations.some((c) => c.id === ids[10]);
    }
    assert.equal(
      admitted,
      true,
      'bounded rotating admission must reach a viable group beyond ten refusals',
    );
    assert.equal(
      (
        await f.pg.query('select conversation_id from relay.invites where email=$1', [
          joining.email,
        ])
      ).rows.length,
      10,
      'refused invitations are retained, not silently deleted to pass the test',
    );
    assert.deepEqual(
      (await f.server.getChat(joining, f.sql)).conversations.map((c) => c.id),
      [ids[10]],
    );
  } finally {
    await f.pg.close();
  }
});

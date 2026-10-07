import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import {
  applySchema,
  ChatError,
  getAttachment,
  getChat,
  mutateChat,
  stageUpload,
  validateAttachments,
} from '../src/lib/server';
import { sqlAdapter } from './helpers/pglite-sql';

const identity = (label: string): User => ({
  id: crypto.randomUUID(),
  email: `${label}@validation-margin.invalid`,
  email_confirmed_at: '2026-10-05T00:00:00Z',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: { name: label },
  created_at: '2026-10-05T00:00:00Z',
});
const rejected = (status: number, message: RegExp) => (error: unknown) =>
  error instanceof ChatError && error.status === status && message.test(error.message);

async function fixture(kind: 'dm' | 'group' = 'group') {
  const pg = new PGlite();
  let fault: ((query: string) => void) | undefined;
  const observe = (engine: { query: typeof pg.query }) => ({
    query: async (query: string, parameters?: unknown[]) => {
      fault?.(query);
      return engine.query(query, parameters);
    },
  });
  const sql = sqlAdapter(observe(pg), (work) => pg.transaction((tx) => work(observe(tx))));
  const owner = identity('Owner'),
    peer = identity('Peer'),
    outsider = identity('Outsider');
  await applySchema(sql);
  await getChat(owner, sql);
  const conversationId = (
    await mutateChat(
      owner,
      { type: 'create', kind, name: 'Validation group', emails: [peer.email!] },
      sql,
    )
  ).id!;
  await getChat(peer, sql);
  await pg.query('delete from relay.events');
  return {
    pg,
    sql,
    owner,
    peer,
    outsider,
    conversationId,
    fault: (next?: typeof fault) => {
      fault = next;
    },
  };
}

// Compare durable rows, including preferences and timestamps, rather than only
// counting rejected requests. These tables have no route quota traffic here.
async function durableSnapshot(pg: PGlite) {
  const tables = [
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
  ];
  const result: Record<string, unknown[]> = {};
  for (const table of tables)
    result[table] = (
      await pg.query(`select to_jsonb(t) as row from relay.${table} t order by to_jsonb(t)::text`)
    ).rows;
  return result;
}

test('invalid conversation kinds, recipients and preferences leave all durable rows unchanged', async () => {
  const f = await fixture('dm');
  try {
    const baseline = await durableSnapshot(f.pg);
    const create = { type: 'create', kind: 'group', name: 'Rejected group', emails: [] };
    const actions = [
      [{ ...create, kind: 'meeting' }, /direct message, group, or space/],
      [{ ...create, emails: 'Peer@example.invalid' }, /Invite up to 30/],
      [
        { ...create, emails: Array.from({ length: 31 }, (_, i) => `member${i}@example.invalid`) },
        /Invite up to 30/,
      ],
      [{ ...create, emails: ['no-at-sign.invalid'] }, /valid email addresses/],
      [{ ...create, kind: 'dm' }, /one other person/],
      [{ ...create, kind: 'dm', emails: [f.peer.email, f.outsider.email] }, /one other person/],
      [
        { type: 'invite', conversationId: f.conversationId, emails: [f.outsider.email] },
        /Create a group/,
      ],
      [
        { type: 'conversation', conversationId: f.conversationId, pinned: 'true' },
        /Invalid preference/,
      ],
      [{ type: 'conversation', conversationId: f.conversationId, muted: 1 }, /Invalid preference/],
      [{ type: 'read', conversationId: f.conversationId, unread: null }, /Invalid preference/],
    ] as const;
    for (const [action, message] of actions) {
      await assert.rejects(
        mutateChat(
          f.owner,
          {
            ...action,
            clientActionId: crypto.randomUUID(),
            clientActionCreatedAt: new Date().toISOString(),
          },
          f.sql,
        ),
        rejected(400, message),
      );
      assert.deepEqual(
        await durableSnapshot(f.pg),
        baseline,
        'a rejected action cannot leave a receipt, invitation, preference, event or partial creation',
      );
    }
    assert.deepEqual(
      (await getChat(f.peer, f.sql)).conversations.map((c) => c.id),
      [f.conversationId],
    );
  } finally {
    await f.pg.close();
  }
});

function file(type: string, bytes: Buffer, name = 'signature-fixture') {
  return { name, type, size: bytes.length, url: `data:${type};base64,${bytes.toString('base64')}` };
}

test('JPEG, GIF and WebP signature gates retain exact protected bytes and reject mislabeled files atomically', async () => {
  const f = await fixture();
  // This gate checks the server's documented MIME signature validation, not
  // complete image decoding. Pixel rendering is separately covered in browsers.
  const files = [
    file('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]), 'tiny.jpg'),
    file(
      'image/gif',
      Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
      'tiny.gif',
    ),
    file('image/webp', Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary'), 'tiny.webp'),
  ];
  try {
    const saved = await mutateChat(
      f.owner,
      { type: 'send', conversationId: f.conversationId, text: '', attachments: files },
      f.sql,
    );
    assert.ok(saved.id);
    assert.equal(saved.state.messages.length, 1);
    assert.deepEqual(
      saved.state.messages[0].attachments.map(({ name, type, size }) => ({ name, type, size })),
      files.map(({ name, type, size }) => ({ name, type, size })),
    );
    for (let i = 0; i < files.length; i++) {
      const expected = Buffer.from(files[i].url.split(',')[1], 'base64');
      for (const member of [f.owner, f.peer])
        assert.deepEqual((await getAttachment(member, saved.id, i, f.sql)).bytes, expected);
      await assert.rejects(
        getAttachment(f.outsider, saved.id, i, f.sql),
        rejected(404, /not available/),
      );
    }
    const baseline = await durableSnapshot(f.pg);
    for (const type of ['image/jpeg', 'image/gif', 'image/webp']) {
      await assert.rejects(
        mutateChat(
          f.owner,
          {
            type: 'send',
            conversationId: f.conversationId,
            text: 'Never saved',
            clientMessageId: crypto.randomUUID(),
            attachments: [file(type, Buffer.from('Different container'))],
          },
          f.sql,
        ),
        rejected(400, /does not match its type/),
      );
      assert.deepEqual(await durableSnapshot(f.pg), baseline);
    }
  } finally {
    await f.pg.close();
  }
});

test('malformed attachment collections, primitives and base64 cannot persist a message or upload', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(
      validateAttachments(undefined),
      [],
      'the optional attachment utility accepts an omitted collection',
    );
    const baseline = await durableSnapshot(f.pg);
    const attachment = file('text/plain', Buffer.from('One file'), 'one.txt');
    const rejectedFiles = [
      [null, /Attach up to 3/],
      [Array.from({ length: 4 }, () => attachment), /Attach up to 3/],
      [[null], /Invalid attachment/],
      [[123], /Invalid attachment/],
      [[{ ...attachment, url: 'data:text/plain;base64,***=' }], /Invalid attachment data/],
    ] as const;
    for (const [attachments, message] of rejectedFiles) {
      await assert.rejects(
        mutateChat(
          f.owner,
          {
            type: 'send',
            conversationId: f.conversationId,
            text: 'Never saved',
            clientMessageId: crypto.randomUUID(),
            attachments,
          } as unknown,
          f.sql,
        ),
        rejected(400, message),
      );
      assert.deepEqual(await durableSnapshot(f.pg), baseline);
    }
    for (const input of [null, undefined, 7, 'chunk']) {
      await assert.rejects(
        stageUpload(f.owner, input, f.sql),
        rejected(400, /Invalid file upload/),
      );
      assert.deepEqual(await durableSnapshot(f.pg), baseline);
    }
  } finally {
    await f.pg.close();
  }
});

test('malformed avatar metadata is omitted and a database failure during automatic enrichment rolls back', async () => {
  const f = await fixture();
  try {
    const malformed = { ...f.owner, user_metadata: { name: 'Owner', avatar_url: 'not a URL' } };
    assert.equal((await getChat(malformed, f.sql)).user.avatar, undefined);
    assert.equal(
      (await getChat(f.peer, f.sql)).conversations[0].members.find((m) => m.id === f.owner.id)!
        .avatar,
      undefined,
    );
    const baseline = await durableSnapshot(f.pg);
    const unavailable = Object.assign(new Error('Synthetic database disconnect'), {
      code: '08006',
    });
    let failures = 0;
    f.fault((query) => {
      if (query.includes('order by p.id for no key update of p')) {
        failures++;
        throw unavailable;
      }
    });
    const enriched = {
      ...f.owner,
      user_metadata: { name: 'Owner', avatar_url: 'https://lh3.googleusercontent.com/avatar.png' },
    };
    await assert.rejects(getChat(enriched, f.sql), (error) => error === unavailable);
    assert.equal(failures, 1, 'uncertain database failures must not replay enrichment');
    f.fault();
    assert.deepEqual(
      await durableSnapshot(f.pg),
      baseline,
      'the attempted avatar update rolls back with its failed admission check',
    );
    assert.equal((await getChat(enriched, f.sql)).user.avatar, enriched.user_metadata.avatar_url);
    assert.equal(
      (await getChat(f.peer, f.sql)).conversations[0].members.find((m) => m.id === f.owner.id)!
        .avatar,
      enriched.user_metadata.avatar_url,
    );
  } finally {
    await f.pg.close();
  }
});

test('a failed authoritative-email synchronization does not cache a false success and recovers on the next request', async () => {
  const f = await fixture();
  try {
    const baseline = await durableSnapshot(f.pg);
    const changed = { ...f.owner, email: 'new-owner@validation-margin.invalid' };
    const failure = Object.assign(new Error('Synthetic SQL connection failure'), { code: '08006' });
    let attempts = 0;
    f.fault((query) => {
      if (query.startsWith('update relay.profiles set email=')) {
        attempts++;
        throw failure;
      }
    });
    await assert.rejects(getChat(changed, f.sql), (error) => error === failure);
    assert.equal(attempts, 1);
    f.fault();
    assert.deepEqual(await durableSnapshot(f.pg), baseline);
    const recovered = await getChat(changed, f.sql);
    assert.equal(recovered.user.id, f.owner.id);
    assert.equal(recovered.user.email, changed.email);
    assert.deepEqual(
      recovered.conversations.map((c) => c.id),
      [f.conversationId],
    );
    assert.equal(
      (await getChat(f.peer, f.sql)).conversations[0].members.find((m) => m.id === f.owner.id)!
        .email,
      changed.email,
    );
    assert.equal((await f.pg.query('select * from relay.events')).rows.length, 0);
    assert.equal((await f.pg.query('select * from relay.operations')).rows.length, 0);
  } finally {
    await f.pg.close();
  }
});

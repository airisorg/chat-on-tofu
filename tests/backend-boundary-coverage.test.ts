import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import {
  applySchema,
  ChatError,
  getAttachment,
  getChat,
  getChatResult,
  mutateChat,
  stageUpload,
} from '../src/lib/server';
import { sqlAdapter } from './helpers/pglite-sql';

const identity = (label: string): User => ({
  id: crypto.randomUUID(),
  email: `${label}@boundary.fixture.invalid`,
  email_confirmed_at: '2026-10-05T00:00:00Z',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: { name: label },
  created_at: '2026-10-05T00:00:00Z',
});
const status = (expected: number) => (error: unknown) =>
  error instanceof ChatError && error.status === expected;

async function fixture() {
  const pg = new PGlite();
  let eventFault: (() => void) | undefined;
  const observe = (engine: { query: typeof pg.query }) => ({
    query: async (query: string, parameters?: unknown[]) => {
      if (query.includes('insert into relay.events')) eventFault?.();
      return engine.query(query, parameters);
    },
  });
  const sql = sqlAdapter(observe(pg), (work) => pg.transaction((tx) => work(observe(tx))));
  await applySchema(sql);
  const owner = identity('Owner'),
    peer = identity('Peer');
  await getChat(owner, sql);
  const conversationId = (
    await mutateChat(
      owner,
      { type: 'create', kind: 'group', name: 'Boundary group', emails: [peer.email!] },
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
    conversationId,
    fault: (value?: () => void) => {
      eventFault = value;
    },
  };
}

test('two definite deadlock aborts retry an atomic receipt and create only one final fanout', async () => {
  const f = await fixture();
  let attempts = 0;
  const action = {
    type: 'profile',
    status: 'Confirmed after retry',
    clientActionId: crypto.randomUUID(),
    clientActionCreatedAt: new Date().toISOString(),
  };
  try {
    f.fault(() => {
      if (++attempts <= 2)
        throw Object.assign(new Error('Synthetic definite abort'), { code: '40P01' });
    });
    const saved = await mutateChat(f.owner, action, f.sql);
    assert.equal(attempts, 3);
    assert.equal(saved.state.user.status, action.status);
    assert.equal(saved.actionId, action.clientActionId);
    assert.equal((await f.pg.query('select id from relay.operations')).rows.length, 1);
    assert.equal((await f.pg.query('select id from relay.events')).rows.length, 2);
    await mutateChat(f.owner, action, f.sql);
    assert.equal(attempts, 3, 'receipt replay must not retry the mutation or fanout');
  } finally {
    await f.pg.close();
  }
});

test('deadlock retry exhaustion rolls back profile state, receipt and event fanout', async () => {
  const f = await fixture();
  let attempts = 0;
  try {
    f.fault(() => {
      attempts++;
      throw Object.assign(new Error('Synthetic definite abort'), { code: '40P01' });
    });
    await assert.rejects(
      mutateChat(
        f.owner,
        {
          type: 'profile',
          name: 'Never committed',
          clientActionId: crypto.randomUUID(),
          clientActionCreatedAt: new Date().toISOString(),
        },
        f.sql,
      ),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === '40P01',
    );
    assert.equal(attempts, 3);
    f.fault();
    assert.equal((await getChat(f.owner, f.sql)).user.name, 'Owner');
    assert.equal((await f.pg.query('select id from relay.operations')).rows.length, 0);
    assert.equal((await f.pg.query('select id from relay.events')).rows.length, 0);
  } finally {
    await f.pg.close();
  }
});

test('unknown completion, transport failure and non-deadlock SQL errors never replay a mutation', async () => {
  const f = await fixture();
  try {
    const previousStatus = (await getChat(f.owner, f.sql)).user.status;
    for (const code of ['40003', '40001', '08006', undefined]) {
      let attempts = 0;
      const failure = Object.assign(new Error('Synthetic ambiguous failure'), code ? { code } : {});
      f.fault(() => {
        attempts++;
        throw failure;
      });
      await assert.rejects(
        mutateChat(
          f.owner,
          {
            type: 'profile',
            status: 'Not confirmed',
            clientActionId: crypto.randomUUID(),
            clientActionCreatedAt: new Date().toISOString(),
          },
          f.sql,
        ),
        (error: unknown) => error === failure,
      );
      assert.equal(attempts, 1, `only definite deadlocks are replayable (${code ?? 'transport'})`);
      f.fault();
      assert.equal((await getChat(f.owner, f.sql)).user.status, previousStatus);
      assert.equal((await f.pg.query('select id from relay.operations')).rows.length, 0);
      assert.equal((await f.pg.query('select id from relay.events')).rows.length, 0);
    }
  } finally {
    await f.pg.close();
  }
});

test('receipt clock validation fails before changing a workspace and owner lookup never leaks an action', async () => {
  const f = await fixture();
  try {
    for (const timestamp of [
      undefined,
      null,
      123,
      'not-a-date',
      new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ])
      await assert.rejects(
        mutateChat(
          f.owner,
          {
            type: 'profile',
            name: 'Wrong clock',
            clientActionId: crypto.randomUUID(),
            clientActionCreatedAt: timestamp,
          },
          f.sql,
        ),
        status(400),
      );
    assert.equal((await getChat(f.owner, f.sql)).user.name, 'Owner');
    assert.equal((await f.pg.query('select id from relay.operations')).rows.length, 0);
    const action = {
      type: 'create',
      name: 'Owned receipt',
      kind: 'space',
      emails: [],
      clientActionId: crypto.randomUUID(),
      clientActionCreatedAt: new Date().toISOString(),
    };
    const created = await mutateChat(f.owner, action, f.sql);
    const own = await getChatResult(f.owner, action.clientActionId, f.sql);
    assert.equal(own.actionId, action.clientActionId);
    assert.equal(own.id, created.id);
    const foreign = await getChatResult(f.peer, action.clientActionId, f.sql);
    assert.equal(foreign.actionId, undefined);
    assert.equal(foreign.id, undefined);
    assert.ok(foreign.state.conversations.every((c) => c.id !== created.id));
    await f.pg.query(
      "update relay.operations set expires_at=now()-interval '1 second' where id=$1",
      [action.clientActionId],
    );
    assert.equal((await getChatResult(f.owner, action.clientActionId, f.sql)).actionId, undefined);
  } finally {
    await f.pg.close();
  }
});

test('committed binary chunks remain immutable after acknowledgement and staging cleanup', async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.from('immutable binary fixture'),
      messageId = crypto.randomUUID();
    const chunk = {
      clientMessageId: messageId,
      conversationId: f.conversationId,
      attachmentIndex: 0,
      name: 'fixture.txt',
      type: 'text/plain',
      size: bytes.length,
      chunkIndex: 0,
      totalChunks: 1,
      data: bytes.toString('base64'),
    };
    await stageUpload(f.owner, chunk, f.sql);
    await mutateChat(
      f.owner,
      {
        type: 'send',
        conversationId: f.conversationId,
        text: '',
        clientMessageId: messageId,
        attachments: [
          { name: chunk.name, type: chunk.type, size: chunk.size, url: `upload:${messageId}:0` },
        ],
      },
      f.sql,
    );
    const before = await f.pg.query('select id from relay.events');
    assert.deepEqual(await stageUpload(f.owner, chunk, f.sql), { ok: true });
    for (const change of [
      { data: Buffer.alloc(bytes.length, 65).toString('base64') },
      { name: 'changed.txt' },
      { attachmentIndex: 1 },
    ])
      await assert.rejects(stageUpload(f.owner, { ...chunk, ...change }, f.sql), status(409));
    await assert.rejects(stageUpload(f.peer, chunk, f.sql), status(409));
    const saved = await getAttachment(f.peer, messageId, '0', f.sql);
    assert.deepEqual(saved.bytes, bytes);
    assert.equal(saved.file.name, chunk.name);
    assert.equal((await f.pg.query('select message_id from relay.uploads')).rows.length, 0);
    assert.deepEqual(
      await f.pg.query('select id from relay.events'),
      before,
      'chunk replay never creates message events',
    );
    for (const index of ['00', '0.0', true, null, -1, 3])
      await assert.rejects(getAttachment(f.peer, messageId, index, f.sql), status(404));
  } finally {
    await f.pg.close();
  }
});

test('deleted targets and cross-conversation parents fail without receipt or invalidation side effects', async () => {
  const f = await fixture();
  try {
    const messageId = (
      await mutateChat(
        f.owner,
        { type: 'send', conversationId: f.conversationId, text: 'Delete target' },
        f.sql,
      )
    ).id!;
    await mutateChat(f.owner, { type: 'delete', messageId }, f.sql);
    const before = (await f.pg.query('select id from relay.events')).rows.length;
    for (const action of [
      { type: 'react', messageId, emoji: '👍', active: true },
      { type: 'star', messageId, starred: true },
      { type: 'edit', messageId, text: 'Resurrect' },
    ])
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
        (error: unknown) => error instanceof ChatError && [400, 403].includes(error.status),
      );
    const second = (
      await mutateChat(
        f.owner,
        { type: 'create', kind: 'space', name: 'Other conversation', emails: [] },
        f.sql,
      )
    ).id!;
    const parent = (
      await mutateChat(
        f.owner,
        { type: 'send', conversationId: second, text: 'Other parent' },
        f.sql,
      )
    ).id!;
    const count = (await f.pg.query('select id from relay.messages')).rows.length;
    await assert.rejects(
      mutateChat(
        f.owner,
        {
          type: 'send',
          conversationId: f.conversationId,
          parentId: parent,
          text: 'Wrong conversation',
        },
        f.sql,
      ),
      /thread is no longer available/,
    );
    assert.equal((await f.pg.query('select id from relay.messages')).rows.length, count);
    assert.equal((await f.pg.query('select id from relay.operations')).rows.length, 0);
    assert.equal((await f.pg.query('select id from relay.events')).rows.length, before + 2);
    assert.equal(
      (await getChat(f.owner, f.sql)).messages.find((m) => m.id === messageId)?.deleted,
      true,
    );
  } finally {
    await f.pg.close();
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import { applySchema, ChatError, getChat, getAttachment, mutateChat } from '../src/lib/server';
import { sqlAdapter } from './helpers/pglite-sql';

const user = (name: string, email: string): User => ({
  id: crypto.randomUUID(),
  email,
  email_confirmed_at: '2026-10-05T00:00:00Z',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: { name },
  created_at: '2026-10-05T00:00:00Z',
});

for (const operation of ['create', 'invite'] as const)
  test(`new ${operation} requires current verified email before assigning a cached address to an identity`, async () => {
    const pg = new PGlite(),
      sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
    const oldEmail = 'recycled@ownership-test.invalid',
      former = user('Former owner', oldEmail),
      inviter = user('Inviter', 'inviter@ownership-test.invalid');
    try {
      await applySchema(sql);
      await getChat(former, sql);
      await getChat(inviter, sql);
      const oldMembership = (
        await mutateChat(
          former,
          { type: 'create', kind: 'space', name: 'Existing ID-bound workspace', emails: [] },
          sql,
        )
      ).id!;
      const target = (
        await mutateChat(
          inviter,
          {
            type: 'create',
            kind: 'group',
            name: 'New confidential group',
            emails: operation === 'create' ? [oldEmail] : [],
          },
          sql,
        )
      ).id!;
      if (operation === 'invite')
        await mutateChat(
          inviter,
          { type: operation, conversationId: target, emails: [oldEmail] },
          sql,
        );
      assert.equal(
        (
          await pg.query(
            'select user_id from relay.participants where conversation_id=$1 and user_id=$2',
            [target, former.id],
          )
        ).rows.length,
        0,
        'cached profile email cannot authorize a NEW private membership',
      );
      assert.equal(
        (
          await pg.query('select email from relay.invites where conversation_id=$1 and email=$2', [
            target,
            oldEmail,
          ])
        ).rows.length,
        1,
      );
      const file = {
        name: 'private.txt',
        type: 'text/plain',
        size: 6,
        url: 'data:text/plain;base64,c2VjcmV0',
      };
      const messageId = (
        await mutateChat(
          inviter,
          { type: 'send', conversationId: target, text: 'Private content', attachments: [file] },
          sql,
        )
      ).id!;
      const renamed = { ...former, email: 'former-new@ownership-test.invalid' };
      const formerState = await getChat(renamed, sql);
      assert.deepEqual(
        formerState.conversations.map((c) => c.id),
        [oldMembership],
        'email changes preserve prior ID-bound access without granting the recycled address invitation',
      );
      await assert.rejects(
        getAttachment(renamed, messageId, 0, sql),
        (error) => error instanceof ChatError && error.status === 404,
      );
      await assert.rejects(
        mutateChat(renamed, { type: 'send', conversationId: target, text: 'Unauthorized' }, sql),
        (error) => error instanceof ChatError && error.status === 404,
      );
      const current = user('Current email owner', oldEmail),
        currentState = await getChat(current, sql);
      assert.deepEqual(
        currentState.conversations.map((c) => c.id),
        [target],
      );
      assert.equal(currentState.messages.find((m) => m.id === messageId)?.text, 'Private content');
      assert.equal(
        (await pg.query('select email from relay.invites where conversation_id=$1', [target])).rows
          .length,
        0,
      );
      assert.equal(
        (await getChat(current, sql)).conversations.length,
        1,
        'verified claims remain idempotent',
      );
      assert.equal(
        (
          await pg.query(
            'select user_id from relay.participants where conversation_id=$1 and user_id=$2',
            [target, former.id],
          )
        ).rows.length,
        0,
      );
    } finally {
      await pg.close();
    }
  });

test('an unsynchronized old email collision fails closed without transferring memberships', async () => {
  const pg = new PGlite(),
    sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
  const former = user('Former', 'collision@ownership-test.invalid'),
    current = user('Current', former.email!);
  try {
    await applySchema(sql);
    await getChat(former, sql);
    const target = (
      await mutateChat(
        former,
        { type: 'create', kind: 'space', name: 'Original workspace', emails: [] },
        sql,
      )
    ).id!;
    await assert.rejects(
      getChat(current, sql),
      (error) => error instanceof ChatError && error.status === 409,
    );
    assert.equal(
      (await pg.query('select id from relay.profiles where id=$1', [current.id])).rows.length,
      0,
    );
    assert.equal(
      (
        await pg.query<{ user_id: string }>(
          'select user_id from relay.participants where conversation_id=$1',
          [target],
        )
      ).rows[0].user_id,
      former.id,
    );
    assert.deepEqual(
      (await getChat(former, sql)).conversations.map((c) => c.id),
      [target],
    );
  } finally {
    await pg.close();
  }
});

test('a cached existing-member address cannot suppress a new current-owner invitation', async () => {
  const pg = new PGlite(),
    sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
  const former = user('Former', 'old-member@ownership-test.invalid'),
    inviter = user('Inviter', 'new-inviter@ownership-test.invalid');
  try {
    await applySchema(sql);
    await getChat(former, sql);
    await getChat(inviter, sql);
    const target = (
      await mutateChat(
        inviter,
        {
          type: 'create',
          kind: 'group',
          name: 'Previously authorized group',
          emails: [former.email!],
        },
        sql,
      )
    ).id!;
    await getChat(former, sql);
    await mutateChat(
      inviter,
      { type: 'invite', conversationId: target, emails: [former.email!] },
      sql,
    );
    assert.equal(
      (
        await pg.query('select email from relay.invites where conversation_id=$1 and email=$2', [
          target,
          former.email,
        ])
      ).rows.length,
      1,
      'last-observed email of an existing member is not fresh recipient ownership',
    );
    const renamed = { ...former, email: 'new-member-address@ownership-test.invalid' };
    assert.equal(
      (await getChat(renamed, sql)).conversations[0].id,
      target,
      'prior ID-bound membership remains authorized',
    );
    const current = user('Current owner', former.email!);
    await getChat(current, sql);
    const state = await getChat(inviter, sql);
    assert.deepEqual(
      new Set(state.conversations[0].members.map((member) => member.id)),
      new Set([inviter.id, former.id, current.id]),
    );
    assert.equal(
      (await pg.query('select email from relay.invites where conversation_id=$1', [target])).rows
        .length,
      0,
    );
  } finally {
    await pg.close();
  }
});

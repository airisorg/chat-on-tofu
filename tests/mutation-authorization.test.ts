import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import type { ChatAction } from '../src/lib/types';
import { applySchema, ChatError, getChat, getChatResult, mutateChat } from '../src/lib/server';
import { sqlAdapter } from './helpers/pglite-sql';

function account(label: string): User {
  return {
    id: crypto.randomUUID(),
    email: `${label}@mutation-authorization.invalid`,
    email_confirmed_at: new Date().toISOString(),
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: { full_name: label },
    created_at: new Date().toISOString(),
  };
}

async function privateRows(pg: PGlite) {
  const snapshot: Record<string, unknown> = {};
  // Static fixture identifiers; include effects other than returned state.
  for (const table of [
    'profiles',
    'conversations',
    'participants',
    'invites',
    'messages',
    'reactions',
    'stars',
    'uploads',
    'operations',
    'events',
  ]) {
    snapshot[table] = (
      await pg.query(
        `select coalesce(jsonb_agg(row order by row::text),'[]'::jsonb) as data from relay.${table} row`,
      )
    ).rows;
  }
  return snapshot;
}

test('all resource-scoped outsider mutations roll back every private effect and expose no receipt', async () => {
  const pg = new PGlite(),
    sql = sqlAdapter(pg, (callback) => pg.transaction((tx) => callback(tx)));
  const [owner, peer, outsider] = ['owner', 'peer', 'outsider'].map(account);
  try {
    await applySchema(sql);
    for (const user of [owner, peer, outsider]) await getChat(user, sql);
    const conversationId = (
      await mutateChat(
        owner,
        { type: 'create', kind: 'group', name: 'Private group', emails: [peer.email!] },
        sql,
      )
    ).id!;
    await getChat(peer, sql);
    const messageId = (
      await mutateChat(owner, { type: 'send', conversationId, text: 'Private original' }, sql)
    ).id!;
    const outsiderId = (
      await mutateChat(
        outsider,
        { type: 'create', kind: 'space', name: 'Own unrelated space', emails: [] },
        sql,
      )
    ).id!;
    const before = await privateRows(pg);
    const actions: ChatAction[] = [
      {
        type: 'send',
        conversationId,
        text: 'Unauthorized send',
        clientMessageId: crypto.randomUUID(),
      },
      { type: 'edit', messageId, text: 'Unauthorized edit' },
      { type: 'delete', messageId },
      { type: 'react', messageId, emoji: '👍', active: true },
      { type: 'star', messageId, starred: true },
      { type: 'read', conversationId, unread: true },
      {
        type: 'conversation',
        conversationId,
        name: 'Unauthorized rename',
        pinned: true,
        muted: true,
        section: 'Unauthorized section',
      },
      { type: 'invite', conversationId, emails: [outsider.email!] },
      { type: 'leave', conversationId },
    ];
    for (const action of actions) {
      const clientActionId = crypto.randomUUID();
      const payload =
        action.type === 'send'
          ? action
          : { ...action, clientActionId, clientActionCreatedAt: new Date().toISOString() };
      await assert.rejects(
        mutateChat(outsider, payload, sql),
        (error) => error instanceof ChatError && error.status === 404,
        action.type,
      );
      assert.deepEqual(
        await privateRows(pg),
        before,
        `${action.type} may not change profiles, membership, messages, preferences, staging, receipts or events`,
      );
      const result = await getChatResult(outsider, clientActionId, sql);
      assert.equal(result.actionId, undefined, `${action.type} rejection has no success receipt`);
      assert.deepEqual(
        result.state.conversations.map((conversation) => conversation.id),
        [outsiderId],
      );
      assert.deepEqual(result.state.messages, []);
    }
    const retained = await getChat(peer, sql);
    assert.equal(retained.messages[0].id, messageId);
    assert.equal(retained.messages[0].text, 'Private original');
    assert.equal(retained.conversations[0].name, 'Private group');
  } finally {
    await pg.close();
  }
});

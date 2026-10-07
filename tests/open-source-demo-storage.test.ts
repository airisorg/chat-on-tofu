import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDemoAction, createDemoState } from '../src/lib/demo';
import { isStoredDemoState } from '../src/lib/demo-storage';

test('valid local preview, edited metadata and supported attachment bytes survive validation', () => {
  const state = createDemoState();
  state.messages[0].attachments = [
    { name: 'note.txt', type: 'text/plain', size: 3, url: 'data:text/plain;base64,YWJj' },
  ];
  state.messages[0].edited = true;
  state.messages[0].starred = true;
  assert.equal(isStoredDemoState(state), true);
});

test('malformed browser-storage fields cannot reach rendering assumptions', () => {
  const changes: [readonly (string | number)[], unknown][] = [
    [['user', 'name'], undefined],
    [['user', 'email'], { toString: null }],
    [['user', 'color'], {}],
    [['user', 'avatar'], 'javascript:alert(1)'],
    [['conversations', 0, 'members', 0], null],
    [['conversations', 0, 'name'], 7],
    [['conversations', 0, 'kind'], 'unknown'],
    [['conversations', 0, 'updatedAt'], 'not a date'],
    [['conversations', 0, 'unread'], '2'],
    [['messages', 0, 'author', 'name'], {}],
    [['messages', 0, 'text'], null],
    [['messages', 0, 'reactions'], [{ emoji: '👍', userIds: null }]],
    [['messages', 0, 'attachments'], [null]],
    [
      ['messages', 0, 'attachments'],
      [
        {
          name: 'active.svg',
          type: 'image/svg+xml',
          size: 3,
          url: 'data:image/svg+xml;base64,YWJj',
        },
      ],
    ],
    [['messages', 0, 'parentId'], 'demo-message-6'],
  ];
  for (const [path, value] of changes) {
    const state = createDemoState();
    let target: unknown = state;
    for (const key of path.slice(0, -1)) target = (target as Record<string, unknown>)[key];
    (target as Record<string, unknown>)[path.at(-1)!] = value;
    assert.equal(isStoredDemoState(state), false, path.join('.'));
  }
  const duplicate = createDemoState();
  duplicate.messages.push(duplicate.messages[0]);
  assert.equal(isStoredDemoState(duplicate), false);
  for (const value of [null, [], {}, 'unexpected']) assert.equal(isStoredDemoState(value), false);
});

test('maximum accepted demo invitation survives action-generated person IDs and JSON reload', () => {
  const email = `${'a'.repeat(242)}@example.com`;
  assert.equal(email.length, 254);
  const created = applyDemoAction(createDemoState(), {
    type: 'create',
    kind: 'group',
    name: 'Maximum invitation',
    emails: [email],
  });
  const conversation = created.state.conversations.find((item) => item.id === created.id)!;
  const invited = conversation.members.find((member) => member.email === email)!;
  assert.equal(invited.id, `demo-invite-${email}`);
  assert.equal(invited.id.length, 266);
  assert.equal(invited.name.length, 242);
  assert.equal(isStoredDemoState(JSON.parse(JSON.stringify(created.state))), true);

  const updated = applyDemoAction(createDemoState(), {
    type: 'invite',
    conversationId: 'demo-design',
    emails: [email],
  });
  assert.equal(isStoredDemoState(JSON.parse(JSON.stringify(updated.state))), true);
});

test('conversation and message map keys reject prototype names and malformed syntax', () => {
  for (const unsafe of [
    '__proto__',
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'demo/path',
    'demo id',
    'demo:name',
  ]) {
    const conversationState = createDemoState();
    const oldConversationId = conversationState.conversations[0].id;
    conversationState.conversations[0].id = unsafe;
    for (const message of conversationState.messages)
      if (message.conversationId === oldConversationId) message.conversationId = unsafe;
    assert.equal(isStoredDemoState(conversationState), false, `conversation key ${unsafe}`);

    const messageState = createDemoState();
    const oldMessageId = messageState.messages[0].id;
    messageState.messages[0].id = unsafe;
    for (const message of messageState.messages)
      if (message.parentId === oldMessageId) message.parentId = unsafe;
    assert.equal(isStoredDemoState(messageState), false, `message key ${unsafe}`);
  }
});

test('valid action-generated nested replies survive JSON reload validation', () => {
  const reply = applyDemoAction(createDemoState(), {
    type: 'send',
    conversationId: 'demo-design',
    parentId: 'demo-message-5',
    text: 'First reply',
  });
  const nested = applyDemoAction(reply.state, {
    type: 'send',
    conversationId: 'demo-design',
    parentId: reply.id,
    text: 'Reply to a reply',
  });
  assert.equal(nested.state.messages.at(-1)?.parentId, reply.id);
  assert.equal(isStoredDemoState(JSON.parse(JSON.stringify(nested.state))), true);
});

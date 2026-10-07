import type { ChatState } from './types';
import { restoreAttachment } from './draft-storage';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number, empty = false): value is string =>
  typeof value === 'string' && value.length <= max && (empty || !!value.trim());
const optionalText = (value: unknown, max: number) => value === undefined || text(value, max, true);
const optionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean';
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const id = (value: unknown): value is string => text(value, 256);
// Conversation/message IDs become ordinary-object draft keys. Person IDs do
// not: generated invite IDs intentionally include a full accepted email.
const mapId = (value: unknown): value is string =>
  id(value) && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) && !Object.hasOwn(Object.prototype, value);
const personId = (value: unknown): value is string =>
  id(value) || (text(value, 266) && /^demo-invite-[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));

function person(value: unknown) {
  if (!record(value)) return false;
  const invited = typeof value.email === 'string' && value.id === `demo-invite-${value.email}`;
  if (
    !personId(value.id) ||
    !text(value.name, invited ? 254 : 80) ||
    !text(value.email, 254) ||
    !optionalText(value.status, 80)
  )
    return false;
  if (
    value.color !== undefined &&
    (typeof value.color !== 'string' || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value.color))
  )
    return false;
  if (value.avatar !== undefined) {
    if (typeof value.avatar !== 'string') return false;
    try {
      const url = new URL(value.avatar);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        !/^(?:[a-z0-9-]+\.)*googleusercontent\.com$/i.test(url.hostname)
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Validate the explicit local preview, never an authenticated API response. */
export function isStoredDemoState(value: unknown): value is ChatState {
  if (
    !record(value) ||
    !person(value.user) ||
    !record(value.user) ||
    value.user.id !== 'demo-you' ||
    !Array.isArray(value.conversations) ||
    !Array.isArray(value.messages)
  )
    return false;
  const conversations = new Set<string>();
  for (const conversation of value.conversations) {
    if (
      !record(conversation) ||
      !mapId(conversation.id) ||
      conversations.has(conversation.id) ||
      !text(conversation.name, 80) ||
      !['dm', 'group', 'space'].includes(String(conversation.kind)) ||
      !Array.isArray(conversation.members) ||
      !conversation.members.length ||
      !conversation.members.every(person) ||
      !date(conversation.updatedAt) ||
      !Number.isInteger(conversation.unread) ||
      (conversation.unread as number) < 0 ||
      !optionalText(conversation.description, 500) ||
      !optionalText(conversation.lastMessage, 6000) ||
      !optionalText(conversation.section, 40) ||
      !optionalBoolean(conversation.pinned) ||
      !optionalBoolean(conversation.muted)
    )
      return false;
    conversations.add(conversation.id);
  }
  const messages = new Set<string>();
  for (const message of value.messages) {
    if (
      !record(message) ||
      !mapId(message.id) ||
      messages.has(message.id) ||
      !mapId(message.conversationId) ||
      !conversations.has(message.conversationId) ||
      !person(message.author) ||
      !text(message.text, 6000, true) ||
      !date(message.createdAt) ||
      !Array.isArray(message.attachments) ||
      message.attachments.length > 3 ||
      !message.attachments.every((attachment) => restoreAttachment(attachment) !== null) ||
      !Array.isArray(message.reactions) ||
      !message.reactions.every(
        (reaction) =>
          record(reaction) &&
          text(reaction.emoji, 32) &&
          Array.isArray(reaction.userIds) &&
          reaction.userIds.every(personId),
      ) ||
      !(message.parentId === undefined || mapId(message.parentId)) ||
      !optionalBoolean(message.edited) ||
      !optionalBoolean(message.starred) ||
      !optionalBoolean(message.deleted)
    )
      return false;
    messages.add(message.id);
  }
  // Demo history is stored in full; a restored thread must belong to its parent.
  const byId = new Map(value.messages.map((message) => [message.id, message]));
  return value.messages.every(
    (message) =>
      !message.parentId ||
      (message.parentId !== message.id &&
        byId.get(message.parentId)?.conversationId === message.conversationId),
  );
}

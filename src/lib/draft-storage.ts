import type { Attachment, Conversation } from './types';
import { MAX_ACTION_BODY_BYTES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from './media-limits';

export type DraftMap = Record<
  string,
  { text: string; attachments: Attachment[]; omittedAttachments?: boolean }
>;
const supportedType =
  /^(image\/(png|jpeg|gif|webp)|text\/plain|application\/pdf|audio\/(webm|mp4|ogg|mpeg|wav))$/;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function restoreAttachment(value: unknown): Attachment | null {
  if (
    !record(value) ||
    typeof value.name !== 'string' ||
    !value.name ||
    value.name.length > 120 ||
    typeof value.type !== 'string' ||
    !supportedType.test(value.type) ||
    typeof value.size !== 'number' ||
    !Number.isInteger(value.size) ||
    value.size < 1 ||
    value.size > MAX_ATTACHMENT_BYTES ||
    typeof value.url !== 'string'
  )
    return null;
  const prefix = `data:${value.type};base64,`;
  if (!value.url.startsWith(prefix)) return null;
  const bytes = value.url.slice(prefix.length);
  if (bytes.length !== 4 * Math.ceil(value.size / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(bytes))
    return null;
  const padding = bytes.endsWith('==') ? 2 : bytes.endsWith('=') ? 1 : 0;
  if ((bytes.length / 4) * 3 - padding !== value.size) return null;
  return { name: value.name, type: value.type, size: value.size, url: value.url };
}

/** Browser storage is untrusted: recover valid fields only for current member conversations. */
export function restoreDraftMap(
  raw: string | null,
  conversations: readonly Pick<Conversation, 'id'>[],
): DraftMap {
  const restored: DraftMap = Object.create(null);
  if (!raw || raw.length > MAX_ACTION_BODY_BYTES) return restored;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!record(parsed)) return restored;
    const allowed = new Set(conversations.map((conversation) => conversation.id));
    for (const [id, value] of Object.entries(parsed)) {
      if (!allowed.has(id) || !record(value)) continue;
      const text = typeof value.text === 'string' && value.text.length <= 6000 ? value.text : '';
      const attachments = Array.isArray(value.attachments)
        ? value.attachments
            .slice(0, MAX_ATTACHMENTS)
            .map(restoreAttachment)
            .filter((attachment): attachment is Attachment => !!attachment)
        : [];
      restored[id] = {
        text,
        attachments,
        ...(value.omittedAttachments === true ? { omittedAttachments: true } : {}),
      };
    }
  } catch {
    /* An invalid JSON draft resets without disrupting the workspace. */
  }
  return restored;
}

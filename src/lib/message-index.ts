import type { Message } from './types';

/** One history pass serves message badges and Home's non-deleted thread filter. */
export function indexReplies(messages: readonly Pick<Message, 'parentId' | 'deleted'>[]) {
  const counts = new Map<string, number>();
  const activeRoots = new Set<string>();
  for (const message of messages) {
    const parentId = message.parentId;
    if (!parentId) continue;
    counts.set(parentId, (counts.get(parentId) || 0) + 1);
    if (!message.deleted) activeRoots.add(parentId);
  }
  return { counts, activeRoots };
}

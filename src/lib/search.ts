import type { Conversation, Message, Person } from './types';

export type SearchFilters = {
  fromId: string;
  conversationId: string;
  date: 'any' | 'older-week' | 'older-month' | 'older-year' | 'custom';
  after: string;
  before: string;
  file: 'any' | 'file' | 'image' | 'pdf' | 'audio' | 'text';
  hasLink: boolean;
  mentionsMe: boolean;
  sort: 'recent' | 'relevance';
};

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  fromId: '',
  conversationId: '',
  date: 'any',
  after: '',
  before: '',
  file: 'any',
  hasLink: false,
  mentionsMe: false,
  sort: 'recent',
};

export function hasSearchFilters(filters: SearchFilters) {
  return Boolean(
    filters.fromId ||
    filters.conversationId ||
    filters.date !== 'any' ||
    filters.file !== 'any' ||
    filters.hasLink ||
    filters.mentionsMe,
  );
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function mentionsUser(text: string, user: Person) {
  const names = new Set(
    ['all', user.name.trim(), user.name.trim().split(/\s+/)[0], user.email].filter(Boolean),
  );
  return [...names].some((name) =>
    new RegExp(
      `(?:^|[^\\p{L}\\p{N}_@])@${escapeRegex(name)}(?![\\p{L}\\p{N}_@+-]|\\.[\\p{L}\\p{N}_])`,
      'iu',
    ).test(text),
  );
}

export function hasMessageLink(text: string) {
  const candidates = text.match(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi) || [];
  return candidates.some((candidate) => {
    try {
      const url = new URL(/^www\./i.test(candidate) ? `https://${candidate}` : candidate);
      return Boolean(url.hostname) && (url.protocol === 'http:' || url.protocol === 'https:');
    } catch {
      return false;
    }
  });
}

/** Local calendar dates match the dates shown in the app, including DST. */
export function searchDate(value: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return null;
  const [, year, month, day] = parts.map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function olderCutoff(preset: SearchFilters['date'], now: number) {
  const date = new Date(now);
  if (preset === 'older-week') date.setDate(date.getDate() - 7);
  else if (preset === 'older-month' || preset === 'older-year') {
    const day = date.getDate();
    date.setDate(1);
    if (preset === 'older-month') date.setMonth(date.getMonth() - 1);
    else date.setFullYear(date.getFullYear() - 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay));
  }
  return date.getTime();
}

/** Search only the message history and conversations already accessible to this account. */
export function searchLoadedMessages({
  messages,
  conversations,
  user,
  query,
  filters,
  now = Date.now(),
}: {
  messages: Message[];
  conversations: Conversation[];
  user: Person;
  query: string;
  filters: SearchFilters;
  now?: number;
}): Message[] {
  const accessible = new Set(conversations.map((conversation) => conversation.id));
  const phrase = query.trim().toLocaleLowerCase();
  const terms = [...new Set(phrase.split(/\s+/).filter(Boolean))];
  const after = filters.after ? searchDate(filters.after) : null;
  const before = filters.before ? searchDate(filters.before) : null;
  if (
    filters.date === 'custom' &&
    ((filters.after && !after) ||
      (filters.before && !before) ||
      (after && before && after > before))
  )
    return [];
  const beforeEnd = before
    ? new Date(before.getFullYear(), before.getMonth(), before.getDate() + 1).getTime()
    : Infinity;
  const cutoff = olderCutoff(filters.date, now);
  return messages
    .filter((message) => {
      if (message.deleted || !accessible.has(message.conversationId)) return false;
      if (filters.fromId && message.author.id !== filters.fromId) return false;
      if (filters.conversationId && message.conversationId !== filters.conversationId) return false;
      const text =
        `${message.text}\n${message.attachments.map((file) => file.name).join('\n')}`.toLocaleLowerCase();
      if (!terms.every((term) => text.includes(term))) return false;
      const timestamp = Date.parse(message.createdAt);
      if (filters.date !== 'any' && !Number.isFinite(timestamp)) return false;
      if (filters.date.startsWith('older-') && timestamp >= cutoff) return false;
      if (
        filters.date === 'custom' &&
        (timestamp < (after?.getTime() ?? -Infinity) || timestamp >= beforeEnd)
      )
        return false;
      if (
        filters.file !== 'any' &&
        !message.attachments.some(
          (file) =>
            filters.file === 'file' ||
            (filters.file === 'image' && file.type.startsWith('image/')) ||
            (filters.file === 'audio' && file.type.startsWith('audio/')) ||
            (filters.file === 'pdf' && file.type === 'application/pdf') ||
            (filters.file === 'text' && file.type === 'text/plain'),
        )
      )
        return false;
      return (
        (!filters.hasLink || hasMessageLink(message.text)) &&
        (!filters.mentionsMe || mentionsUser(message.text, user))
      );
    })
    .map((message) => {
      const text =
        `${message.text}\n${message.attachments.map((file) => file.name).join('\n')}`.toLocaleLowerCase();
      // A transparent local rank: exact phrase first, then matching word frequency.
      const relevance = phrase
        ? Number(text.includes(phrase)) * 10 +
          terms.reduce((score, term) => score + Math.min(5, text.split(term).length - 1), 0)
        : 0;
      return { message, relevance };
    })
    .sort(
      (a, b) =>
        (filters.sort === 'relevance' ? b.relevance - a.relevance : 0) ||
        (Date.parse(b.message.createdAt) || 0) - (Date.parse(a.message.createdAt) || 0) ||
        a.message.id.localeCompare(b.message.id),
    )
    .map((result) => result.message);
}

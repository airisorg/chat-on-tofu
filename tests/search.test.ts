import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SEARCH_FILTERS,
  hasMessageLink,
  mentionsUser,
  searchDate,
  searchLoadedMessages,
  type SearchFilters,
} from '../src/lib/search';
import type { Conversation, Message, Person } from '../src/lib/types';

const user: Person = {
  id: 'me',
  name: 'Alex Morgan',
  email: 'alex+chat@example.com',
};
const maya: Person = {
  id: 'maya',
  name: 'Maya Chen',
  email: 'maya@example.com',
};
const conversations: Conversation[] = [
  {
    id: 'design',
    name: 'Design team',
    kind: 'space',
    members: [user, maya],
    updatedAt: '2026-10-06T12:00:00Z',
    unread: 0,
  },
];
const message = (
  id: string,
  text: string,
  date: string,
  extra: Partial<Message> = {},
): Message => ({
  id,
  text,
  createdAt: date,
  conversationId: 'design',
  author: maya,
  reactions: [],
  attachments: [],
  ...extra,
});
const search = (
  messages: Message[],
  filters: Partial<SearchFilters> = {},
  query = '',
  now = new Date(2026, 9, 6, 12).getTime(),
) =>
  searchLoadedMessages({
    messages,
    conversations,
    user,
    query,
    filters: { ...DEFAULT_SEARCH_FILTERS, ...filters },
    now,
  }).map((message) => message.id);
const file = (type: string, name = 'file') => ({
  type,
  name,
  size: 12,
  url: '',
  loading: true,
});

test('search excludes deleted and inaccessible messages without altering history', () => {
  const messages = [
    message('visible', 'review', '2026-10-01'),
    message('deleted', 'review', '2026-10-02', { deleted: true }),
    message('left-space', 'review', '2026-10-03', { conversationId: 'left' }),
  ];
  const original = structuredClone(messages);
  assert.deepEqual(search(messages, {}, 'review'), ['visible']);
  assert.deepEqual(messages, original);
});

test('person, conversation, media, link and mention filters intersect', () => {
  const messages = [
    message('match', 'Review @Alex https://example.com', '2026-10-01', {
      attachments: [file('image/png')],
    }),
    message('wrong-author', 'Review @Alex https://example.com', '2026-10-02', {
      author: user,
      attachments: [file('image/png')],
    }),
    message('no-link', 'Review @Alex', '2026-10-02', {
      attachments: [file('image/png')],
    }),
    message('no-mention', 'Review https://example.com', '2026-10-02', {
      attachments: [file('image/png')],
    }),
  ];
  assert.deepEqual(
    search(
      messages,
      {
        fromId: 'maya',
        conversationId: 'design',
        file: 'image',
        hasLink: true,
        mentionsMe: true,
      },
      'review',
    ),
    ['match'],
  );
  assert.deepEqual(search(messages, { conversationId: 'missing' }), []);
});

test('mention boundaries avoid partial names and support the actual email and @all', () => {
  for (const text of [
    'Hi @Alex!',
    'For @Alex Morgan:',
    'Hi @alex+chat@example.com!',
    'Good morning @all.',
  ])
    assert.equal(mentionsUser(text, user), true, text);
  for (const text of [
    'Hi @Alexander',
    'alex@example.com',
    '@allhands',
    '@alex+chat@example.com.evil',
  ])
    assert.equal(mentionsUser(text, user), false, text);
});

test('link detection accepts actual http/www links and rejects plain email or malformed URLs', () => {
  for (const text of [
    'https://example.com/path',
    'http://localhost/test',
    'www.example.com',
    'WWW.example.com',
    'Www.example.com',
  ])
    assert.equal(hasMessageLink(text), true, text);
  for (const text of ['alex@example.com', 'https://', 'javascript:alert(1)'])
    assert.equal(hasMessageLink(text), false, text);
});

test('file type filters use accessible metadata without requiring media downloads', () => {
  const messages = ['image/png', 'application/pdf', 'audio/mp4', 'text/plain'].map((type, index) =>
    message(String(index), 'File', '2026-10-01', { attachments: [file(type)] }),
  );
  for (const [kind, id] of [
    ['image', '0'],
    ['pdf', '1'],
    ['audio', '2'],
    ['text', '3'],
  ] as const)
    assert.deepEqual(search(messages, { file: kind }), [id]);
  assert.equal(search(messages, { file: 'file' }).length, 4);
  assert.deepEqual(search(messages, { file: 'pdf' }, 'missing'), []);
});

test('inclusive custom calendar dates include the whole end day and reject invalid ranges', () => {
  const day = '2026-10-01';
  const messages = [
    message('start', '', new Date(2026, 9, 1, 0).toISOString()),
    message('end', '', new Date(2026, 9, 1, 23, 59, 59).toISOString()),
    message('next', '', new Date(2026, 9, 2, 0).toISOString()),
  ];
  assert.deepEqual(search(messages, { date: 'custom', after: day, before: day }), ['end', 'start']);
  assert.deepEqual(search(messages, { date: 'custom', after: '2026-10-02', before: day }), []);
  assert.deepEqual(search(messages, { date: 'custom', before: '2026-02-30' }), []);
  assert.equal(searchDate('2026-02-30'), null);
});

test('older month/year cutoffs clamp to real leap and month-end dates', () => {
  const now = new Date(2024, 2, 31, 12).getTime();
  const messages = [
    message('before', '', new Date(2024, 1, 29, 11, 59).toISOString()),
    message('boundary', '', new Date(2024, 1, 29, 12).toISOString()),
  ];
  assert.deepEqual(search(messages, { date: 'older-month' }, '', now), ['before']);
  assert.deepEqual(
    search(
      [
        message('year', '', new Date(2023, 1, 28, 11).toISOString()),
        message('recent', '', new Date(2023, 1, 28, 13).toISOString()),
      ],
      { date: 'older-year' },
      '',
      new Date(2024, 1, 29, 12).getTime(),
    ),
    ['year'],
  );
});

test('filename keywords are searchable and relevance differs meaningfully from recency', () => {
  const messages = [
    message('phrase', 'project review', '2026-10-01'),
    message('newest', 'review for the project', '2026-10-05'),
    message('filename', '', '2026-10-02', {
      attachments: [file('application/pdf', 'Roadmap.PDF')],
    }),
  ];
  assert.deepEqual(search(messages, {}, 'PROJECT review'), ['newest', 'phrase']);
  assert.deepEqual(search(messages, { sort: 'relevance' }, 'project review'), ['phrase', 'newest']);
  assert.deepEqual(search(messages, {}, 'roadmap.pdf'), ['filename']);
});

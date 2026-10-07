'use client';

import { useCallback, useState } from 'react';
import { Check, ChevronDown, Link, AtSign, X } from 'lucide-react';
import type { Conversation, Person } from '@/lib/types';
import {
  DEFAULT_SEARCH_FILTERS,
  hasSearchFilters,
  searchDate,
  type SearchFilters as Filters,
} from '@/lib/search';
import ContextPopover from './ContextPopover';
import styles from './SearchFilters.module.css';

type Menu = 'from' | 'conversation' | 'date' | 'file' | 'sort';
const titles: Record<Menu, string> = {
  from: 'From',
  conversation: 'Said in',
  date: 'Date',
  file: 'Has file',
  sort: 'Sort results',
};
const dates: [Filters['date'], string][] = [
  ['any', 'Any time'],
  ['older-week', 'Older than a week'],
  ['older-month', 'Older than a month'],
  ['older-year', 'Older than a year'],
];
const fileTypes: [Filters['file'], string][] = [
  ['any', 'Any message'],
  ['file', 'Any file'],
  ['image', 'Image'],
  ['pdf', 'PDF'],
  ['audio', 'Audio'],
  ['text', 'Text file'],
];

export default function SearchFilters({
  values,
  people,
  conversations,
  resultCount,
  onChange,
}: {
  values: Filters;
  people: Person[];
  conversations: Conversation[];
  resultCount: number;
  onChange: (values: Filters) => void;
}) {
  const [open, setOpen] = useState<{ menu: Menu; anchor: HTMLElement } | null>(null);
  const [find, setFind] = useState('');
  const [custom, setCustom] = useState(false);
  const [after, setAfter] = useState('');
  const [before, setBefore] = useState('');
  const [error, setError] = useState('');
  const close = useCallback(() => setOpen(null), []);
  const choose = (changes: Partial<Filters>) => {
    onChange({ ...values, ...changes });
    close();
  };
  const show = (menu: Menu, anchor: HTMLElement) => {
    setFind('');
    setError('');
    setAfter(values.after);
    setBefore(values.before);
    setCustom(values.date === 'custom');
    setOpen((current) => (current?.menu === menu ? null : { menu, anchor }));
  };
  const person = people.find((person) => person.id === values.fromId);
  const conversation = conversations.find(
    (conversation) => conversation.id === values.conversationId,
  );
  const dateLabel =
    values.date === 'custom' ? 'Custom dates' : dates.find(([key]) => key === values.date)?.[1];
  const fileLabel = fileTypes.find(([key]) => key === values.file)?.[1];
  const chip = (menu: Menu, label: string, active: boolean) => (
    <button
      type="button"
      className={active ? styles.selected : ''}
      aria-label={`${titles[menu]} filter${active ? `, ${label}` : ''}`}
      aria-haspopup="dialog"
      aria-expanded={open?.menu === menu}
      onClick={(event) => show(menu, event.currentTarget)}
    >
      <span>{label}</span>
      <ChevronDown size={16} />
    </button>
  );
  const option = (
    key: string,
    label: string,
    selected: boolean,
    click: () => void,
    secondary?: string,
  ) => (
    <button
      key={key}
      type="button"
      className={selected ? styles.selected : ''}
      aria-pressed={selected}
      onClick={click}
    >
      <span>
        <span>{label}</span>
        {secondary && <small>{secondary}</small>}
      </span>
      {selected && <Check size={18} />}
    </button>
  );
  const candidates =
    open?.menu === 'from'
      ? [...new Map(people.map((person) => [person.id, person])).values()]
          .filter((person) =>
            `${person.name} ${person.email}`.toLocaleLowerCase().includes(find.toLocaleLowerCase()),
          )
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
  const places = conversations
    .filter((conversation) =>
      conversation.name.toLocaleLowerCase().includes(find.toLocaleLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className={styles.container}>
      <div className={styles.filters} role="group" aria-label="Search filters">
        {chip('from', person ? `From: ${person.name}` : 'From', Boolean(values.fromId))}
        {chip(
          'conversation',
          conversation ? `Said in: ${conversation.name}` : 'Said in',
          Boolean(values.conversationId),
        )}
        {chip('date', values.date === 'any' ? 'Date' : dateLabel || 'Date', values.date !== 'any')}
        {chip(
          'file',
          values.file === 'any' ? 'Has file' : fileLabel || 'Has file',
          values.file !== 'any',
        )}
        <button
          type="button"
          className={values.hasLink ? styles.selected : ''}
          aria-pressed={values.hasLink}
          onClick={() => onChange({ ...values, hasLink: !values.hasLink })}
        >
          <Link size={16} />
          Has link
        </button>
        <button
          type="button"
          className={values.mentionsMe ? styles.selected : ''}
          aria-pressed={values.mentionsMe}
          onClick={() => onChange({ ...values, mentionsMe: !values.mentionsMe })}
        >
          <AtSign size={16} />
          Mentions me
        </button>
        <button
          type="button"
          className={styles.sort}
          aria-label={`Sort results: ${values.sort === 'recent' ? 'Most recent' : 'Relevance'}`}
          aria-haspopup="dialog"
          aria-expanded={open?.menu === 'sort'}
          onClick={(event) => show('sort', event.currentTarget)}
        >
          {values.sort === 'recent' ? 'Most recent' : 'Relevance'}
          <ChevronDown size={16} />
        </button>
        {hasSearchFilters(values) && (
          <button
            type="button"
            aria-label="Clear filters"
            onClick={() => onChange({ ...DEFAULT_SEARCH_FILTERS, sort: values.sort })}
          >
            <X size={16} />
            Clear filters
          </button>
        )}
      </div>
      <p className={styles.note}>
        {resultCount} {resultCount === 1 ? 'message' : 'messages'} · Searches the currently loaded
        message history.
      </p>
      {open && (
        <ContextPopover title={titles[open.menu]} anchor={open.anchor} onClose={close}>
          <div className={styles.menu}>
            {(open.menu === 'from' || open.menu === 'conversation') && (
              <>
                <input
                  aria-label={open.menu === 'from' ? 'Find a person' : 'Find a conversation'}
                  placeholder={open.menu === 'from' ? 'Name or email' : 'Conversation name'}
                  value={find}
                  onChange={(event) => setFind(event.target.value)}
                />
                {open.menu === 'from'
                  ? option('from:any', 'Anyone', !values.fromId, () => choose({ fromId: '' }))
                  : option('conversation:all', 'All conversations', !values.conversationId, () =>
                      choose({ conversationId: '' }),
                    )}
                <div className={styles.options}>
                  {open.menu === 'from'
                    ? candidates.map((person) =>
                        option(
                          `from:${person.id}`,
                          person.name,
                          values.fromId === person.id,
                          () => choose({ fromId: person.id }),
                          person.email,
                        ),
                      )
                    : places.map((conversation) =>
                        option(
                          `conversation:${conversation.id}`,
                          conversation.name,
                          values.conversationId === conversation.id,
                          () => choose({ conversationId: conversation.id }),
                          conversation.kind === 'space'
                            ? 'Space'
                            : conversation.kind === 'group'
                              ? 'Group'
                              : 'Direct message',
                        ),
                      )}
                  {(open.menu === 'from' ? candidates : places).length === 0 && (
                    <p className={styles.note}>No matches in your conversations.</p>
                  )}
                </div>
              </>
            )}
            {open.menu === 'date' && (
              <>
                {!custom &&
                  dates.map(([date, label]) =>
                    option(`date:${date}`, label, values.date === date, () =>
                      choose({ date, after: '', before: '' }),
                    ),
                  )}
                {option(
                  'date:custom',
                  custom ? 'Choose a date preset' : 'Custom range',
                  values.date === 'custom',
                  () => {
                    setCustom(!custom);
                    setError('');
                  },
                )}
                {custom && (
                  <form
                    className={styles.dates}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const start = after ? searchDate(after) : null,
                        end = before ? searchDate(before) : null;
                      if ((!after && !before) || (after && !start) || (before && !end)) {
                        setError('Choose an on-or-after or on-or-before date.');
                        return;
                      }
                      if (start && end && start > end) {
                        setError('The end date must be the same as or later than the start date.');
                        return;
                      }
                      choose({ date: 'custom', after, before });
                    }}
                  >
                    <label>
                      On or after
                      <input
                        type="date"
                        value={after}
                        onChange={(event) => {
                          setAfter(event.target.value);
                          setError('');
                        }}
                      />
                    </label>
                    <label>
                      On or before
                      <input
                        type="date"
                        value={before}
                        onChange={(event) => {
                          setBefore(event.target.value);
                          setError('');
                        }}
                      />
                    </label>
                    {error && (
                      <p role="alert" className={styles.error}>
                        {error}
                      </p>
                    )}
                    <button type="submit" className={styles.apply}>
                      Apply dates
                    </button>
                  </form>
                )}
              </>
            )}
            {open.menu === 'file' &&
              fileTypes.map(([file, label]) =>
                option(`file:${file}`, label, values.file === file, () => choose({ file })),
              )}
            {open.menu === 'sort' && (
              <>
                {option('sort:recent', 'Most recent', values.sort === 'recent', () =>
                  choose({ sort: 'recent' }),
                )}
                {option('sort:relevance', 'Relevance', values.sort === 'relevance', () =>
                  choose({ sort: 'relevance' }),
                )}
                <p className={styles.note}>
                  Relevance ranks matching phrases and words in these messages.
                </p>
              </>
            )}
          </div>
        </ContextPopover>
      )}
    </div>
  );
}

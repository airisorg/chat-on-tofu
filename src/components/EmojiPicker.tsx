'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  Car,
  Clock3,
  Flag,
  Heart,
  Leaf,
  Lightbulb,
  Pizza,
  Search,
  Smile,
  Trophy,
  X,
} from 'lucide-react';
import data from '@emoji-mart/data/sets/15/native.json';
import type { Emoji } from '@emoji-mart/data';
import styles from './EmojiPicker.module.css';

type Recent = { id: string; tone: number };
type Preferences = { owner: string; tone: number; recents: Recent[] };
const catalog: Record<string, Emoji> = data.emojis;
const groups = [
  { id: 'recent', name: 'Frequently used', Icon: Clock3 },
  { id: 'people', name: 'Smileys & people', Icon: Smile },
  { id: 'nature', name: 'Animals & nature', Icon: Leaf },
  { id: 'foods', name: 'Food & drink', Icon: Pizza },
  { id: 'activity', name: 'Activities', Icon: Trophy },
  { id: 'places', name: 'Travel & places', Icon: Car },
  { id: 'objects', name: 'Objects', Icon: Lightbulb },
  { id: 'symbols', name: 'Symbols', Icon: Heart },
  { id: 'flags', name: 'Flags', Icon: Flag },
];
const tones = [
  'Default skin tone',
  'Light skin tone',
  'Medium light skin tone',
  'Medium skin tone',
  'Medium dark skin tone',
  'Dark skin tone',
];
const suggested = [
  '+1',
  'heart',
  'joy',
  'tada',
  'white_check_mark',
  'eyes',
  'raised_hands',
  'bulb',
  'fire',
  'pray',
  'sparkles',
  'blush',
];
const aliases = Object.entries(data.aliases).reduce<Record<string, string[]>>(
  (values, [alias, id]) => {
    (values[id] ||= []).push(alias);
    return values;
  },
  {},
);
const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[:_-]+/g, ' ')
    .trim();
const searchable = Object.values(catalog).map((emoji) => ({
  emoji,
  text: normalize(
    [emoji.id, emoji.name, ...emoji.keywords, ...(aliases[emoji.id] || [])].join(' '),
  ),
}));
const storageKey = (id: string) => `chat-emoji-preferences:${encodeURIComponent(id)}`;
const nativeFor = (id: string, tone: number) => {
  const emoji = Object.hasOwn(catalog, id) ? catalog[id] : undefined;
  return emoji?.skins?.[tone]?.native || emoji?.skins?.[0]?.native || '';
};
function readPreferences(owner: string): Preferences {
  const empty = { owner, tone: 0, recents: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(owner)) || 'null') as {
      tone?: number;
      recents?: Recent[];
    } | null;
    return {
      owner,
      tone:
        Number.isInteger(parsed?.tone) && parsed!.tone! >= 0 && parsed!.tone! < 6
          ? parsed!.tone!
          : 0,
      recents: Array.isArray(parsed?.recents)
        ? parsed.recents
            .filter(
              (entry) =>
                entry &&
                typeof entry.id === 'string' &&
                Object.hasOwn(catalog, entry.id) &&
                Number.isInteger(entry.tone) &&
                entry.tone >= 0 &&
                entry.tone < 6,
            )
            .slice(0, 24)
        : [],
    };
  } catch {
    return empty;
  }
}

export default function EmojiPicker({
  onSelect,
  currentUserId,
  selectionLabelPrefix = 'React',
  compact = false,
}: {
  onSelect: (emoji: string) => void;
  currentUserId: string;
  selectionLabelPrefix?: 'React' | 'Insert';
  compact?: boolean;
}) {
  const [query, setQuery] = useState('');
  const panelId = useId();
  const [category, setCategory] = useState('people');
  const [preferences, setPreferences] = useState(() => readPreferences(currentUserId));
  const [toneOpen, setToneOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const toneTrigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const current =
    preferences.owner === currentUserId
      ? preferences
      : { owner: currentUserId, tone: 0, recents: [] };
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const matches = query.trim()
    ? searchable
        .filter(
          ({ emoji, text }) =>
            terms.every((term) => text.includes(term)) ||
            emoji.skins.some((skin) => skin.native === query.trim()),
        )
        .map(({ emoji }) => emoji.id)
    : [];
  useEffect(() => {
    setPreferences(readPreferences(currentUserId));
    setQuery('');
    setCategory('people');
    setToneOpen(false);
  }, [currentUserId]);
  useEffect(() => {
    if (!matchMedia('(max-width: 767px), (pointer: coarse)').matches)
      input.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [category, query]);
  useEffect(() => {
    if (toneOpen)
      root.current
        ?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
        ?.focus({ preventScroll: true });
  }, [toneOpen]);
  function save(next: Preferences) {
    setPreferences(next);
    try {
      localStorage.setItem(
        storageKey(currentUserId),
        JSON.stringify({ tone: next.tone, recents: next.recents }),
      );
    } catch {
      /* Selection remains available when browser storage is disabled. */
    }
  }
  function pick(id: string, tone = current.tone) {
    const emoji = nativeFor(id, tone);
    if (!emoji) return;
    save({
      owner: currentUserId,
      tone: current.tone,
      recents: [
        { id, tone },
        ...current.recents.filter((entry) => nativeFor(entry.id, entry.tone) !== emoji),
      ].slice(0, 24),
    });
    onSelect(emoji);
  }
  function gridKey(event: KeyboardEvent<HTMLButtonElement>) {
    const grid = event.currentTarget.parentElement;
    if (!grid) return;
    const buttons = [...grid.querySelectorAll<HTMLButtonElement>('button')];
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const index = buttons.indexOf(event.currentTarget);
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    };
    if (event.key in steps || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : Math.max(0, Math.min(buttons.length - 1, index + steps[event.key]));
      buttons.forEach((button) => {
        button.tabIndex = -1;
      });
      buttons[next].tabIndex = 0;
      buttons[next].focus({ preventScroll: true });
      buttons[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  function emojiGrid(entries: Recent[]) {
    return (
      <div className={styles.grid} role="group" aria-label="Emoji choices">
        {entries.map(({ id, tone }, index) => {
          const emoji = catalog[id];
          const native = nativeFor(id, tone);
          if (!emoji || !native) return null;
          return (
            <button
              key={`${id}-${tone}`}
              type="button"
              className={styles.emoji}
              data-emoji-id={id}
              aria-label={`${selectionLabelPrefix} ${native}`}
              title={emoji.name}
              tabIndex={index === 0 ? 0 : -1}
              onKeyDown={gridKey}
              onClick={() => pick(id, tone)}
            >
              {native}
            </button>
          );
        })}
      </div>
    );
  }
  const ids = data.categories.find((group) => group.id === category)?.emojis || [];
  return (
    <div
      ref={root}
      className={`${styles.picker} ${compact ? styles.compact : ''}`}
      data-emoji-picker
    >
      <div className={styles.searchRow}>
        <div className={styles.search}>
          <Search size={18} aria-hidden="true" />
          <input
            ref={input}
            aria-label="Search emoji"
            placeholder="Search emoji"
            value={query}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                event.stopPropagation();
                body.current?.querySelector<HTMLButtonElement>('button')?.focus();
              }
            }}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear emoji search"
              onClick={() => {
                setQuery('');
                input.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className={styles.toneControl}>
          <button
            ref={toneTrigger}
            type="button"
            className={styles.toneTrigger}
            aria-label="Skin tone"
            title={tones[current.tone]}
            aria-haspopup="menu"
            aria-expanded={toneOpen}
            onClick={() => setToneOpen((value) => !value)}
          >
            {nativeFor('hand', current.tone)}
          </button>
          {toneOpen && (
            <div
              className={styles.tones}
              role="menu"
              aria-label="Skin tones"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setToneOpen(false);
                  toneTrigger.current?.focus();
                }
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  event.stopPropagation();
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
                  ];
                  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  buttons[
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? 5
                        : (index + (event.key === 'ArrowDown' ? 1 : -1) + 6) % 6
                  ]?.focus();
                }
              }}
            >
              {tones.map((label, tone) => (
                <button
                  key={label}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current.tone === tone}
                  aria-label={label}
                  title={label}
                  onClick={() => {
                    save({ ...current, tone });
                    setToneOpen(false);
                    toneTrigger.current?.focus();
                  }}
                >
                  {nativeFor('hand', tone)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.categories} role="tablist" aria-label="Emoji categories">
        {groups.map(({ id, name, Icon }, index) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${panelId}-${id}`}
            aria-controls={panelId}
            aria-label={name}
            title={name}
            aria-selected={!query.trim() && category === id}
            tabIndex={category === id ? 0 : -1}
            onClick={() => {
              setQuery('');
              setCategory(id);
              setToneOpen(false);
            }}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? groups.length - 1
                      : (index + (event.key === 'ArrowRight' ? 1 : -1) + groups.length) %
                        groups.length;
                setQuery('');
                setCategory(groups[next].id);
                const tabs = root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                tabs?.[next]?.focus();
              }
            }}
          >
            <Icon size={20} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div
        ref={body}
        id={panelId}
        className={styles.body}
        role={query.trim() ? 'region' : 'tabpanel'}
        aria-labelledby={query.trim() ? undefined : `${panelId}-${category}`}
        aria-label={query.trim() ? 'Emoji search results' : undefined}
      >
        {query.trim() ? (
          <section aria-label="Search results">
            <h3 aria-live="polite">Search results · {matches.length}</h3>
            {matches.length ? (
              emojiGrid(matches.map((id) => ({ id, tone: current.tone })))
            ) : (
              <p className={styles.empty}>No emoji found. Try a name or keyword.</p>
            )}
          </section>
        ) : category === 'recent' ? (
          <section aria-label="Frequently used">
            <h3>Frequently used</h3>
            {current.recents.length ? (
              emojiGrid(current.recents)
            ) : (
              <p className={styles.empty}>Emoji you choose will appear here.</p>
            )}
          </section>
        ) : (
          <>
            {category === 'people' && (
              <section aria-label={current.recents.length ? 'Frequently used' : 'Suggested'}>
                <h3>{current.recents.length ? 'Frequently used' : 'Suggested'}</h3>
                {emojiGrid(
                  current.recents.length
                    ? current.recents
                    : suggested.map((id) => ({ id, tone: current.tone })),
                )}
              </section>
            )}
            <section aria-label={groups.find((group) => group.id === category)?.name}>
              <h3>{groups.find((group) => group.id === category)?.name}</h3>
              {emojiGrid(ids.map((id) => ({ id, tone: current.tone })))}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

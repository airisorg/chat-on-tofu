'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Hash, Search, Users, X } from 'lucide-react';
import type { Conversation, Person } from '@/lib/types';
import { MAX_CONVERSATION_MEMBERS } from '@/lib/chat-limits';
import styles from './NewConversationForm.module.css';

type Recipient = Pick<Person, 'name' | 'email'>;
export type NewConversation = {
  name: string;
  kind: Conversation['kind'];
  emails: string[];
  description: string;
};
const validEmail = (email: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email);
const MAX_INVITEES = MAX_CONVERSATION_MEMBERS - 1;
const invitationLimitMessage = `A conversation can have up to ${MAX_CONVERSATION_MEMBERS} people, including you. Add up to ${MAX_INVITEES} others.`;

export default function NewConversationForm({
  kind,
  people,
  currentEmail,
  busy,
  compact = false,
  onKind,
  onSubmit,
  onClose,
}: {
  kind: Conversation['kind'];
  people: Person[];
  currentEmail: string;
  busy: boolean;
  compact?: boolean;
  onKind: (kind: Conversation['kind']) => void;
  onSubmit: (conversation: NewConversation) => Promise<void>;
  onClose: () => void;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState('');
  const contacts = [
    ...new Map(
      people
        .filter((person) => validEmail(person.email))
        .map((person) => [person.email.toLowerCase(), person]),
    ).values(),
  ];
  const chosen = new Set(recipients.map((person) => person.email.toLowerCase()));
  const term = query.trim().toLowerCase();
  const suggestions: Recipient[] = contacts
    .filter(
      (person) =>
        !chosen.has(person.email.toLowerCase()) &&
        (!term || `${person.name} ${person.email}`.toLowerCase().includes(term)),
    )
    .slice(0, 6);
  if (
    validEmail(term) &&
    !chosen.has(term) &&
    !contacts.some((person) => person.email.toLowerCase() === term)
  )
    suggestions.unshift({ email: term, name: term.split('@')[0] });
  const canAdd = (kind !== 'dm' || recipients.length === 0) && recipients.length < MAX_INVITEES;
  const expanded = focused && canAdd && suggestions.length > 0;
  const activeOptionId =
    expanded && active >= 0
      ? `${listId}-option-${Math.min(active, suggestions.length - 1)}`
      : undefined;
  const add = (person: Recipient) => {
    if (!canAdd || chosen.has(person.email.toLowerCase())) return;
    setRecipients((values) => [...values, person]);
    setQuery('');
    setActive(-1);
    setError('');
  };
  const chooseKind = (next: Conversation['kind']) => {
    if (next === 'dm' && recipients.length > 1) setRecipients((values) => values.slice(0, 1));
    setError('');
    onKind(next);
  };
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, [kind]);
  useEffect(() => {
    // aria-activedescendant leaves focus on the input, so the browser will not
    // automatically scroll a keyboard-highlighted option into the list viewport.
    if (activeOptionId)
      document
        .getElementById(activeOptionId)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeOptionId, term, suggestions.length]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = [...recipients];
    const typed = query
      .trim()
      .split(/[,;\s]+/)
      .filter(Boolean);
    for (const email of typed) {
      if (!validEmail(email)) {
        setError(
          'Choose a suggested person or enter a complete email address to invite someone new.',
        );
        return;
      }
      if (!values.some((person) => person.email.toLowerCase() === email.toLowerCase()))
        values.push(
          contacts.find((person) => person.email.toLowerCase() === email.toLowerCase()) || {
            email: email.toLowerCase(),
            name: email.split('@')[0],
          },
        );
    }
    if (kind === 'dm' && values.length !== 1) {
      setError('Choose one person to start a direct message.');
      return;
    }
    if (kind === 'group' && values.length === 0) {
      setError('Add people to start a group conversation.');
      return;
    }
    if (values.some((person) => person.email.toLowerCase() === currentEmail.toLowerCase())) {
      setError('Choose another person to start a conversation.');
      return;
    }
    if (values.length > MAX_INVITEES) {
      setError(invitationLimitMessage);
      return;
    }
    const data = new FormData(event.currentTarget);
    const name =
      String(data.get('name') || '').trim() ||
      values
        .map((person) => person.name)
        .join(', ')
        .slice(0, 80);
    await onSubmit({
      kind,
      name,
      emails: values.map((person) => person.email),
      description: String(data.get('description') || ''),
    });
  }
  return (
    <form
      className={`${styles.form} ${compact ? styles.compact : styles.desktop}`}
      onSubmit={(event) => void submit(event)}
    >
      {compact && (
        <div className="kind-tabs" aria-label="Conversation type">
          {(['dm', 'group', 'space'] as const).map((value) => (
            <button
              disabled={busy}
              type="button"
              key={value}
              className={kind === value ? 'selected' : ''}
              aria-pressed={kind === value}
              onClick={() => chooseKind(value)}
            >
              {value === 'dm' ? 'Direct message' : value === 'group' ? 'Group' : 'Space'}
            </button>
          ))}
        </div>
      )}
      <div className={styles.body}>
        {kind !== 'dm' && (
          <label className={styles.additional}>
            {kind === 'space' ? 'Space name' : 'Group name'}
            <span className="optional">{kind === 'group' ? ' optional' : ''}</span>
            <input
              disabled={busy}
              name="name"
              required={kind === 'space'}
              maxLength={80}
              placeholder={kind === 'space' ? 'e.g. Design team' : 'Name this group'}
              autoComplete="off"
            />
          </label>
        )}
        <div className={styles.picker}>
          <label
            className={kind === 'dm' && !compact ? styles.hidden : undefined}
            htmlFor={`${listId}-input`}
          >
            {kind === 'dm' ? 'To' : 'Add people'}
            {kind === 'space' && <span className="optional"> optional</span>}
          </label>
          {recipients.length > 0 && (
            <div className={styles.chips}>
              {recipients.map((person) => (
                <span key={person.email} className={styles.chip}>
                  <span title={person.email}>{person.name}</span>
                  <button
                    disabled={busy}
                    type="button"
                    aria-label={`Remove ${person.name}`}
                    onClick={() =>
                      setRecipients((values) =>
                        values.filter((value) => value.email !== person.email),
                      )
                    }
                  >
                    <X size={16} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {canAdd && (
            <div className={styles.search}>
              <Search size={18} />
              <input
                disabled={busy}
                ref={input}
                id={`${listId}-input`}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={expanded}
                aria-controls={expanded ? listId : undefined}
                aria-activedescendant={activeOptionId}
                aria-describedby={`${listId}-help`}
                placeholder="Name or email"
                value={query}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onFocus={() => setFocused(true)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                  setError('');
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setFocused(true);
                    setActive((index) =>
                      index < 0
                        ? event.key === 'ArrowDown'
                          ? 0
                          : suggestions.length - 1
                        : (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) %
                          Math.max(1, suggestions.length),
                    );
                  }
                  if (event.key === 'Enter' && expanded) {
                    event.preventDefault();
                    add(suggestions[Math.max(0, Math.min(active, suggestions.length - 1))]);
                  }
                  if (event.key === 'Escape' && expanded && compact) {
                    event.preventDefault();
                    event.stopPropagation();
                    setFocused(false);
                  }
                  if (event.key === 'Backspace' && !query)
                    setRecipients((values) => values.slice(0, -1));
                }}
              />
            </div>
          )}
          {!compact && ((!term && recipients.length === 0) || kind !== 'dm') && (
            <div className={styles.modeActions} aria-label="Conversation actions">
              {kind !== 'dm' && (
                <button disabled={busy} type="button" onClick={() => chooseKind('dm')}>
                  <ArrowLeft size={20} />
                  Direct message
                </button>
              )}
              {kind !== 'space' && (
                <button disabled={busy} type="button" onClick={() => chooseKind('space')}>
                  <Hash size={20} />
                  Create a space
                </button>
              )}
              {kind !== 'group' && (
                <button disabled={busy} type="button" onClick={() => chooseKind('group')}>
                  <Users size={20} />
                  Start a group
                </button>
              )}
            </div>
          )}
          {expanded && (
            <>
              <div className={styles.sectionHeading}>People</div>
              <div
                id={listId}
                role="listbox"
                aria-label="Suggested people"
                className={styles.suggestions}
              >
                {suggestions.map((person, index) => (
                  <button
                    disabled={busy}
                    id={`${listId}-option-${index}`}
                    role="option"
                    aria-selected={active === index}
                    type="button"
                    key={person.email}
                    className={active === index ? styles.active : ''}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => add(person)}
                  >
                    <span className={styles.avatar}>{person.name.slice(0, 1).toUpperCase()}</span>
                    <span>
                      <strong>{person.name}</strong>
                      <small>{person.email}</small>
                    </span>
                    {!contacts.some(
                      (contact) => contact.email.toLowerCase() === person.email.toLowerCase(),
                    ) && <small>Invite</small>}
                  </button>
                ))}
              </div>
            </>
          )}
          <small id={`${listId}-help`} className={styles.help}>
            Search people from your conversations by name or email. Enter an email to invite someone
            new.
          </small>
          {focused && term && suggestions.length === 0 && (
            <p className={styles.hint}>
              No matching people. Enter their full email to send an invitation.
            </p>
          )}
        </div>
        {kind === 'space' && (
          <label className={styles.additional}>
            Description <span className="optional">optional</span>
            <textarea
              disabled={busy}
              name="description"
              rows={3}
              maxLength={500}
              placeholder="What is this space for?"
            />
          </label>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      <div className={`dialog-footer ${styles.footer}`}>
        <button type="button" className="text-button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={busy || (kind !== 'space' && recipients.length === 0 && !query.trim())}
        >
          {busy ? 'Creating…' : kind === 'space' ? 'Create space' : 'Start chat'}
        </button>
      </div>
    </form>
  );
}

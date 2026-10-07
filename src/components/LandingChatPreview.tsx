'use client';

import { useId, useLayoutEffect, useReducer, useRef } from 'react';
import { MessageCircle, RotateCcw, SendHorizontal, Sparkles } from 'lucide-react';
import {
  createPreviewState,
  PREVIEW_TEXT_LIMIT,
  reducePreview,
  SAMPLE_MESSAGE,
} from './landing-preview-state';
import styles from './LandingChatPreview.module.css';

export default function LandingChatPreview() {
  const [state, dispatch] = useReducer(reducePreview, undefined, createPreviewState);
  const history = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const hint = useId();

  useLayoutEffect(() => {
    if (history.current)
      history.current.scrollTop = state.nextId === 3 ? 0 : history.current.scrollHeight;
  }, [state.nextId]);

  function send() {
    if (!state.draft.trim()) return;
    dispatch({ type: 'send' });
    composer.current?.focus({ preventScroll: true });
  }

  return (
    <section id="chat-preview" aria-label="Interactive chat preview" className={styles.preview}>
      <div className={styles.introduction}>
        <span>
          <Sparkles size={16} aria-hidden="true" /> INTERACTIVE PREVIEW
        </span>
        <h2>Try a quick conversation.</h2>
        <p id={hint}>A local sample. Nothing here is sent or saved.</p>
      </div>
      <div className={styles.window}>
        <header className={styles.header}>
          <span className={styles.avatar} aria-hidden="true">
            MC
          </span>
          <div>
            <strong>Maya Chen</strong>
            <span>Sample direct message</span>
          </div>
          <button
            type="button"
            className={styles.reset}
            aria-label="Reset sample conversation"
            title="Reset sample conversation"
            onClick={() => dispatch({ type: 'reset' })}
          >
            <RotateCcw size={18} aria-hidden="true" />
          </button>
        </header>
        <div
          ref={history}
          className={styles.history}
          role="log"
          aria-label="Sample messages"
          aria-live="off"
        >
          {state.messages.map((message) => (
            <article
              key={message.id}
              aria-label={`${message.author === 'Maya' ? 'Maya Chen' : 'You'}: ${message.text}`}
              className={`${styles.message} ${message.author === 'You' ? styles.own : ''}`}
              data-entry={message.id > 2 ? 'new' : undefined}
            >
              <div className={styles.metadata}>
                {message.author === 'Maya' ? 'Maya' : 'You'}
                {message.reply && <span>Sample reply</span>}
              </div>
              <p>{message.text}</p>
              {message.id === 1 && (
                <button
                  type="button"
                  aria-label="React to sample message with raised hands"
                  aria-pressed={state.reacted}
                  className={styles.reaction}
                  onClick={() => dispatch({ type: 'react' })}
                >
                  <span aria-hidden="true">🙌</span> <span>{state.reacted ? 4 : 3}</span>
                </button>
              )}
            </article>
          ))}
        </div>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.suggestion}
            onClick={() => {
              dispatch({ type: 'draft', text: SAMPLE_MESSAGE });
              composer.current?.focus({ preventScroll: true });
            }}
          >
            <MessageCircle size={16} aria-hidden="true" /> Use a sample message
          </button>
          <form
            className={styles.composer}
            aria-label="Sample composer"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <textarea
              ref={composer}
              aria-label="Sample message"
              aria-describedby={hint}
              rows={1}
              value={state.draft}
              maxLength={PREVIEW_TEXT_LIMIT}
              placeholder="Try a message…"
              onChange={(event) => dispatch({ type: 'draft', text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <button type="submit" aria-label="Send sample message" disabled={!state.draft.trim()}>
              <SendHorizontal size={20} aria-hidden="true" />
            </button>
          </form>
          <div className={styles.composerHint}>
            <span>Enter to try it · Shift + Enter for a new line</span>
            <span aria-label={`${state.draft.length} of ${PREVIEW_TEXT_LIMIT} characters`}>
              {state.draft.length}/{PREVIEW_TEXT_LIMIT}
            </span>
          </div>
        </div>
      </div>
      <p className={styles.status} role="status" aria-live="polite" aria-atomic="true">
        {state.status || 'Try sending a message or adding a reaction.'}
      </p>
    </section>
  );
}

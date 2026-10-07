'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { File, Maximize2, Mic, Minus, Plus, SendHorizontal, Smile, X } from 'lucide-react';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '@/lib/media-limits';
import type { Attachment, Conversation, Message } from '@/lib/types';
import VoiceRecorder from './VoiceRecorder';
import AudioPreview from './AudioPreview';
import styles from './MiniConversation.module.css';

export type MiniDraft = { text: string; attachments: Attachment[] };
const EmojiPicker = dynamic(() => import('./EmojiPicker'), {
  ssr: false,
  loading: () => <p role="status">Loading emoji…</p>,
});

export default function MiniConversation({
  conversation,
  messages,
  draft,
  minimized,
  avatar,
  offline,
  pending,
  currentUserId,
  renderMessage,
  onDraft,
  onSend,
  onMinimize,
  onRestore,
  onExpand,
  onClose,
}: {
  conversation: Conversation;
  messages: Message[];
  draft: MiniDraft;
  minimized: boolean;
  avatar: ReactNode;
  offline: boolean;
  pending: boolean;
  currentUserId: string;
  renderMessage: (message: Message) => ReactNode;
  onDraft: (draft: MiniDraft) => void;
  onSend: (draft: MiniDraft) => Promise<void>;
  onMinimize: () => void;
  onRestore: () => void;
  onExpand: () => void;
  onClose: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [readingFiles, setReadingFiles] = useState(false);
  const [error, setError] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const restoreTrigger = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const emojiPicker = useRef<HTMLDivElement>(null);
  const emojiTrigger = useRef<HTMLButtonElement>(null);
  const atBottom = useRef(true);
  const alive = useRef(true);
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const locked = sending || pending;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (minimized) {
      setVoiceOpen(false);
      setEmojiOpen(false);
      const frame = requestAnimationFrame(() =>
        restoreTrigger.current?.focus({ preventScroll: true }),
      );
      return () => cancelAnimationFrame(frame);
    }
    atBottom.current = true;
    const frame = requestAnimationFrame(() => composer.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [minimized]);
  useEffect(() => {
    const element = composer.current;
    if (element) {
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, 96)}px`;
    }
  }, [draft.text, minimized, voiceOpen]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (atBottom.current) element.scrollTop = element.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  }, [messages, minimized, voiceOpen]);
  useEffect(() => {
    if (!emojiOpen) return;
    const focusSearch = () => {
      const input = emojiPicker.current?.querySelector<HTMLInputElement>(
        'input[aria-label="Search emoji"]',
      );
      if (input && document.activeElement === emojiTrigger.current) input.focus();
      return !!input;
    };
    const observer = new MutationObserver(() => {
      if (focusSearch()) observer.disconnect();
    });
    if (emojiPicker.current && !focusSearch())
      observer.observe(emojiPicker.current, { childList: true, subtree: true });
    const dismiss = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !emojiPicker.current?.contains(event.target) &&
        !emojiTrigger.current?.contains(event.target)
      )
        setEmojiOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    return () => {
      observer.disconnect();
      document.removeEventListener('mousedown', dismiss);
    };
  }, [emojiOpen]);

  async function send() {
    if (locked || readingFiles || voiceOpen || (!draft.text.trim() && !draft.attachments.length))
      return;
    setSending(true);
    setError('');
    atBottom.current = true;
    try {
      await onSend(draft);
      if (alive.current) composer.current?.focus({ preventScroll: true });
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Message wasn’t sent. Your draft is saved; try again.',
        );
    } finally {
      if (alive.current) setSending(false);
    }
  }
  async function addFiles(files: FileList | null) {
    if (!files || locked || readingFiles) return;
    setReadingFiles(true);
    setError('');
    const incoming: Attachment[] = [];
    try {
      for (const file of Array.from(files)) {
        const raw = file.type.toLowerCase().split(';')[0];
        const type =
          raw === 'audio/x-m4a' || raw === 'audio/m4a' || (!raw && /\.m4a$/i.test(file.name))
            ? 'audio/mp4'
            : raw === 'audio/x-wav'
              ? 'audio/wav'
              : raw;
        if (file.size > MAX_ATTACHMENT_BYTES)
          throw new Error(`${file.name} is too large. Choose a file 5 MB or smaller.`);
        if (currentDraft.current.attachments.length + incoming.length >= MAX_ATTACHMENTS)
          throw new Error(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
        if (
          !/^(image\/(png|jpeg|gif|webp)|text\/plain|application\/pdf|audio\/(webm|mp4|ogg|mpeg|wav))$/.test(
            type,
          )
        )
          throw new Error('Choose a PNG, JPG, GIF, WebP image, text file, PDF, or audio file.');
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('This file couldn’t be read. Please try again.'));
          reader.readAsDataURL(file);
        });
        if (!alive.current) return;
        incoming.push({
          name: file.name,
          type,
          size: file.size,
          url: url.replace(/^data:[^;]+;/, `data:${type};`),
        });
      }
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : 'This file couldn’t be attached.');
    } finally {
      if (alive.current) {
        if (incoming.length)
          onDraft({
            ...currentDraft.current,
            attachments: [...currentDraft.current.attachments, ...incoming].slice(
              0,
              MAX_ATTACHMENTS,
            ),
          });
        setReadingFiles(false);
        if (fileInput.current) fileInput.current.value = '';
      }
    }
  }

  return (
    <section
      className={`${styles.panel} ${minimized ? styles.minimized : ''}`}
      role="region"
      aria-label={`Mini conversation: ${conversation.name}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && (emojiOpen || voiceOpen)) {
          event.stopPropagation();
          setEmojiOpen(false);
          setVoiceOpen(false);
          composer.current?.focus();
        }
      }}
    >
      <header className={styles.header}>
        {avatar}
        {minimized ? (
          <button
            ref={restoreTrigger}
            type="button"
            className={styles.title}
            aria-label="Restore pop-up"
            onClick={onRestore}
          >
            {conversation.name}
          </button>
        ) : (
          <strong className={styles.title}>{conversation.name}</strong>
        )}
        {!minimized && (
          <button
            type="button"
            className={styles.icon}
            aria-label="Minimize pop-up"
            title="Minimize"
            onClick={onMinimize}
          >
            <Minus size={19} />
          </button>
        )}
        <button
          type="button"
          className={styles.icon}
          aria-label="Expand conversation"
          title="Expand conversation"
          disabled={locked || readingFiles}
          onClick={onExpand}
        >
          <Maximize2 size={18} />
        </button>
        <button
          type="button"
          className={styles.icon}
          aria-label="Close pop-up"
          title="Close pop-up"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {!minimized && (
        <>
          {voiceOpen ? (
            <div className={styles.voice}>
              <div className={styles.voiceHeader}>
                <strong>Record a voice message</strong>
                <button
                  type="button"
                  className={styles.icon}
                  aria-label="Cancel pop-up voice recording"
                  onClick={() => setVoiceOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <VoiceRecorder
                onClose={() => setVoiceOpen(false)}
                onRecorded={(attachment) => {
                  const value = currentDraft.current;
                  if (value.attachments.length >= MAX_ATTACHMENTS) {
                    setError(`Attach up to ${MAX_ATTACHMENTS} files per message.`);
                    return;
                  }
                  onDraft({ ...value, attachments: [...value.attachments, attachment] });
                }}
              />
            </div>
          ) : (
            <div
              className={styles.messages}
              ref={scroller}
              aria-label="Pop-up messages"
              onScroll={() => {
                const element = scroller.current;
                if (element)
                  atBottom.current =
                    element.scrollHeight - element.scrollTop - element.clientHeight < 80;
              }}
            >
              {messages.length ? (
                messages.map(renderMessage)
              ) : (
                <p className={styles.empty}>Start the conversation with {conversation.name}.</p>
              )}
            </div>
          )}
          <div className={styles.footer}>
            {offline && (
              <p className={styles.notice} role="status">
                Your device may be offline. You can try sending; your draft stays here if it fails.
              </p>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {!!draft.attachments.length && (
              <div className={styles.attachments}>
                {draft.attachments.map((attachment, index) => (
                  <div className={styles.attachment} key={`${attachment.name}:${index}`}>
                    {attachment.type.startsWith('audio/') ? <Mic size={15} /> : <File size={15} />}
                    <span title={attachment.name}>{attachment.name}</span>
                    <button
                      type="button"
                      className={styles.icon}
                      aria-label={`Remove ${attachment.name} from pop-up`}
                      disabled={locked || readingFiles}
                      onClick={() =>
                        onDraft({
                          ...draft,
                          attachments: draft.attachments.filter((_, i) => index !== i),
                        })
                      }
                    >
                      <X size={15} />
                    </button>
                    {attachment.type.startsWith('audio/') && (
                      <AudioPreview
                        controls
                        src={attachment.url}
                        aria-label="Pop-up voice note preview"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            {emojiOpen && (
              <div
                ref={emojiPicker}
                className={styles.emoji}
                role="group"
                aria-label="Pop-up emoji picker"
              >
                <EmojiPicker
                  compact
                  currentUserId={currentUserId}
                  selectionLabelPrefix="Insert"
                  onSelect={(emoji) => {
                    const value = currentDraft.current;
                    const start = composer.current?.selectionStart ?? value.text.length;
                    const end = composer.current?.selectionEnd ?? start;
                    if (value.text.length - (end - start) + emoji.length > 6000) {
                      setError('Messages can contain up to 6,000 characters.');
                      return;
                    }
                    onDraft({
                      ...value,
                      text: value.text.slice(0, start) + emoji + value.text.slice(end),
                    });
                    setError('');
                    setEmojiOpen(false);
                    requestAnimationFrame(() => {
                      composer.current?.focus({ preventScroll: true });
                      composer.current?.setSelectionRange(
                        start + emoji.length,
                        start + emoji.length,
                      );
                    });
                  }}
                />
              </div>
            )}
            <div className={styles.composer}>
              <textarea
                ref={composer}
                aria-label="Message in pop-up"
                placeholder={`Message ${conversation.name}`}
                value={draft.text}
                rows={1}
                maxLength={6000}
                disabled={locked}
                onChange={(event) => onDraft({ ...draft, text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                  if (event.key === 'Escape') {
                    setEmojiOpen(false);
                    setVoiceOpen(false);
                  }
                }}
              />
              <div className={styles.controls}>
                <button
                  ref={emojiTrigger}
                  type="button"
                  className={styles.icon}
                  aria-label="Add emoji to pop-up"
                  aria-expanded={emojiOpen}
                  disabled={locked}
                  onClick={() => setEmojiOpen(!emojiOpen)}
                >
                  <Smile size={20} />
                </button>
                <button
                  type="button"
                  className={styles.icon}
                  aria-label="Record voice note in pop-up"
                  aria-expanded={voiceOpen}
                  disabled={locked || readingFiles || draft.attachments.length >= MAX_ATTACHMENTS}
                  onClick={() => {
                    setVoiceOpen(true);
                    setEmojiOpen(false);
                  }}
                >
                  <Mic size={19} />
                </button>
                <button
                  type="button"
                  className={styles.icon}
                  aria-label="Attach files to pop-up"
                  title="Attach files up to 5 MB each"
                  disabled={locked || readingFiles || draft.attachments.length >= MAX_ATTACHMENTS}
                  onClick={() => fileInput.current?.click()}
                >
                  <Plus size={22} />
                </button>
                <button
                  type="button"
                  className={`${styles.icon} ${styles.send}`}
                  aria-label="Send pop-up message"
                  disabled={
                    locked ||
                    readingFiles ||
                    voiceOpen ||
                    (!draft.text.trim() && !draft.attachments.length)
                  }
                  onClick={() => void send()}
                >
                  <SendHorizontal size={20} />
                </button>
              </div>
            </div>
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp,text/plain,application/pdf,audio/webm,audio/mp4,audio/ogg,audio/mpeg,audio/wav,audio/x-m4a,audio/x-wav,.m4a"
              onChange={(event) => void addFiles(event.target.files)}
            />
            <small className={styles.hint}>
              {locked
                ? 'Sending…'
                : readingFiles
                  ? 'Adding files…'
                  : 'Enter to send · Shift + Enter for a new line'}
            </small>
          </div>
        </>
      )}
    </section>
  );
}

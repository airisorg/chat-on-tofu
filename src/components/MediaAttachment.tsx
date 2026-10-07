'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, File, Mic, RefreshCw } from 'lucide-react';
import type { Attachment } from '@/lib/types';
import AudioPlayer from './AudioPlayer';
import styles from './MediaAttachment.module.css';

export default function MediaAttachment({
  attachment,
  messageId,
  index,
  onLoad,
  onRetry,
  onPreview,
  shared = false,
}: {
  attachment: Attachment;
  messageId: string;
  index: number;
  onLoad: (messageId: string, index: number) => void;
  onRetry: (messageId: string, index: number) => void;
  onPreview: (attachment: Attachment) => void;
  shared?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failedImageSource, setFailedImageSource] = useState('');
  const ready = !!attachment.url && !attachment.loading && !attachment.error;
  useEffect(() => {
    if (ready || attachment.error || !container.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      onLoad(messageId, index);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onLoad(messageId, index);
        observer.disconnect();
      }
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [ready, attachment.error, messageId, index, onLoad]);

  return (
    <div className={`${styles.wrapper} ${shared ? styles.shared : ''}`} ref={container}>
      {!ready ? (
        <div className={styles.placeholder} role={attachment.error ? undefined : 'status'}>
          {attachment.type.startsWith('audio/') ? <Mic size={21} /> : <File size={21} />}
          <span>
            <strong>{attachment.name}</strong>
            <small>
              {attachment.error ? 'Couldn’t load this file. Try again.' : 'Loading attachment…'}
            </small>
          </span>
          {attachment.error && (
            <button
              className={styles.retry}
              type="button"
              aria-label={`Retry ${attachment.name}`}
              onClick={() => onRetry(messageId, index)}
            >
              <RefreshCw size={17} />
              Retry
            </button>
          )}
        </div>
      ) : shared ? (
        <a className={styles.sharedLink} href={attachment.url} download={attachment.name}>
          <File size={20} />
          <span>{attachment.name}</span>
          <ArrowDownToLine size={17} />
        </a>
      ) : attachment.type.startsWith('image/') && failedImageSource === attachment.url ? (
        <div className={styles.placeholder} role="status">
          <File size={21} />
          <span>
            <strong>{attachment.name}</strong>
            <small>Image preview unavailable. Download the original file.</small>
          </span>
          <a
            className={styles.retry}
            href={attachment.url}
            download={attachment.name}
            aria-label={`Download ${attachment.name}`}
          >
            <ArrowDownToLine size={20} />
          </a>
        </div>
      ) : attachment.type.startsWith('audio/') ? (
        <AudioPlayer src={attachment.url} name={attachment.name} size={attachment.size} />
      ) : (
        <a
          href={attachment.url}
          download={attachment.name}
          aria-label={
            attachment.type.startsWith('image/') ? `Preview ${attachment.name}` : undefined
          }
          aria-haspopup={attachment.type.startsWith('image/') ? 'dialog' : undefined}
          onClick={
            attachment.type.startsWith('image/')
              ? (event) => {
                  event.preventDefault();
                  onPreview(attachment);
                }
              : undefined
          }
          className={
            attachment.type.startsWith('image/')
              ? `image-attachment ${styles.imageTile}`
              : 'file-attachment'
          }
        >
          {attachment.type.startsWith('image/') ? (
            <img
              key={attachment.url}
              src={attachment.url}
              alt={attachment.name}
              onError={() => setFailedImageSource(attachment.url)}
            />
          ) : (
            <File size={21} />
          )}
          {!attachment.type.startsWith('image/') && (
            <span>
              {attachment.name}
              <small>{Math.max(1, Math.round(attachment.size / 1024))} KB · Download</small>
            </span>
          )}
        </a>
      )}
    </div>
  );
}

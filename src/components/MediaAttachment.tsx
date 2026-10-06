"use client";

import { useEffect, useRef } from "react";
import { ArrowDownToLine, File, Mic, RefreshCw } from "lucide-react";
import type { Attachment } from "@/lib/types";
import styles from "./MediaAttachment.module.css";

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
  const ready = !!attachment.url && !attachment.loading && !attachment.error;
  useEffect(() => {
    if (ready || attachment.error || !container.current) return;
    if (typeof IntersectionObserver === "undefined") {
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
    <div
      className={`${styles.wrapper} ${shared ? styles.shared : ""}`}
      ref={container}
    >
      {!ready ? (
        <div
          className={styles.placeholder}
          role={attachment.error ? undefined : "status"}
        >
          {attachment.type.startsWith("audio/") ? (
            <Mic size={21} />
          ) : (
            <File size={21} />
          )}
          <span>
            <strong>{attachment.name}</strong>
            <small>
              {attachment.error
                ? "Couldn’t load this file. Try again."
                : "Loading attachment…"}
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
        <a
          className={styles.sharedLink}
          href={attachment.url}
          download={attachment.name}
        >
          <File size={20} />
          <span>{attachment.name}</span>
          <ArrowDownToLine size={17} />
        </a>
      ) : attachment.type.startsWith("audio/") ? (
        <div className="audio-attachment">
          <audio
            controls
            preload="metadata"
            src={attachment.url}
            aria-label={`Play ${attachment.name}`}
          />
          <a href={attachment.url} download={attachment.name}>
            <Mic size={14} />
            {attachment.name}
            <ArrowDownToLine size={14} />
          </a>
        </div>
      ) : (
        <a
          href={attachment.url}
          download={attachment.name}
          aria-haspopup={
            attachment.type.startsWith("image/") ? "dialog" : undefined
          }
          onClick={
            attachment.type.startsWith("image/")
              ? (event) => {
                  event.preventDefault();
                  onPreview(attachment);
                }
              : undefined
          }
          className={
            attachment.type.startsWith("image/")
              ? "image-attachment"
              : "file-attachment"
          }
        >
          {attachment.type.startsWith("image/") ? (
            <img src={attachment.url} alt={attachment.name} />
          ) : (
            <File size={21} />
          )}
          <span>
            {attachment.name}
            <small>
              {Math.max(1, Math.round(attachment.size / 1024))} KB · Download
            </small>
          </span>
        </a>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, LoaderCircle, Pause, Play } from "lucide-react";
import { audioDataUrlBytes } from "@/lib/audio-bytes";
import styles from "./AudioPlayer.module.css";

const timestamp = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, "0")}`;
const PLAY_EVENT = "chat-audio-player-play";

/** Message players and native draft/recording previews share one playback lane. */
export function announceAudioPlayback(active: HTMLAudioElement) {
  document.querySelectorAll("audio").forEach((element) => {
    if (element !== active) element.pause();
  });
  document.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: active }));
}

export default function AudioPlayer({
  src,
  name,
  size,
}: {
  src: string;
  name: string;
  size: number;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const currentSource = useRef(src);
  currentSource.current = src;
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState(false);
  const [duration, setDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [rate, setRate] = useState(1);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    generation.current += 1;
    const element = audio.current;
    setPlaying(false);
    setPending(false);
    setDuration(0);
    setElapsed(0);
    setRate(1);
    setPeaks([]);
    setError("");
    const pauseOther = (event: Event) => {
      if ((event as CustomEvent).detail !== audio.current)
        audio.current?.pause();
    };
    document.addEventListener(PLAY_EVENT, pauseOther);
    return () => {
      alive.current = false;
      document.removeEventListener(PLAY_EVENT, pauseOther);
      element?.pause();
    };
  }, [src]);
  useEffect(() => {
    // Only bounded, already downloaded audio is decoded. A plain progress
    // track remains usable when metadata is unknown or decoding is unavailable.
    if (
      !duration ||
      duration > 120 ||
      size > 5 * 1024 * 1024 ||
      !/^(blob:|data:audio\/)/.test(src) ||
      typeof OfflineAudioContext === "undefined"
    )
      return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    void (async () => {
      try {
        let bytes: ArrayBuffer;
        if (src.startsWith("data:")) {
          // Local draft/demo bytes need no external connection permission.
          const local = audioDataUrlBytes(src);
          if (!local) return;
          bytes = local;
        } else {
          const response = await fetch(src, { signal: controller.signal });
          if (!response.ok) return;
          bytes = await response.arrayBuffer();
        }
        if (cancelled || bytes.byteLength > 5 * 1024 * 1024) return;
        const context = new OfflineAudioContext(1, 1, 22050);
        const decoded = await context.decodeAudioData(bytes);
        if (cancelled || decoded.duration > 120) return;
        const samples = decoded.getChannelData(0);
        const bars = 48;
        const values = Array.from({ length: bars }, (_, index) => {
          const start = Math.floor((index * samples.length) / bars);
          const end = Math.floor(((index + 1) * samples.length) / bars);
          let sum = 0;
          for (let offset = start; offset < end; offset++)
            sum += samples[offset] ** 2;
          return Math.sqrt(sum / Math.max(1, end - start));
        });
        const maximum = Math.max(...values, 0.001);
        if (!cancelled) setPeaks(values.map((value) => value / maximum));
      } catch {
        /* Unsupported codecs retain the real audio player's progress track. */
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [src, duration, size]);

  function metadata() {
    const value = audio.current?.duration;
    if (value && Number.isFinite(value)) setDuration(value);
  }
  async function toggle() {
    const element = audio.current;
    const ticket = generation.current;
    const requestedSource = src;
    const current = () =>
      alive.current &&
      generation.current === ticket &&
      currentSource.current === requestedSource;
    if (!element || pending) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    setError("");
    setPending(true);
    try {
      if (element.ended) element.currentTime = 0;
      await element.play();
    } catch {
      if (current())
        setError(
          "This audio can’t play in this browser. Download it to listen.",
        );
    } finally {
      if (current()) setPending(false);
    }
  }
  const progress = duration ? Math.min(100, (elapsed / duration) * 100) : 0;
  return (
    <div className={styles.wrapper}>
      <div
        className={styles.player}
        role="group"
        aria-label={`Voice message: ${name}`}
      >
        <audio
          ref={audio}
          className={styles.audioNode}
          preload="metadata"
          src={src}
          aria-label={`Play ${name}`}
          onLoadedMetadata={metadata}
          onDurationChange={metadata}
          onTimeUpdate={() => setElapsed(audio.current?.currentTime || 0)}
          onPlay={() => {
            setPlaying(true);
            if (audio.current) announceAudioPlayback(audio.current);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            if (!duration && audio.current?.currentTime)
              setDuration(audio.current.currentTime);
          }}
          onError={() => {
            setPlaying(false);
            setPending(false);
            setError(
              "This audio can’t play in this browser. Download it to listen.",
            );
          }}
        />
        <button
          type="button"
          className={styles.play}
          aria-label={`${playing ? "Pause" : "Play"} voice message`}
          disabled={pending}
          onClick={() => void toggle()}
        >
          {pending ? (
            <LoaderCircle size={20} className={styles.loading} />
          ) : playing ? (
            <Pause size={20} fill="currentColor" />
          ) : (
            <Play size={20} fill="currentColor" />
          )}
        </button>
        <div className={styles.middle}>
          <div className={styles.seek}>
            {peaks.length ? (
              <svg
                className={styles.waveform}
                viewBox="0 0 192 40"
                preserveAspectRatio="none"
                role="img"
                aria-label="Audio waveform"
                data-waveform="decoded"
              >
                {peaks.map((peak, index) => {
                  const height = Math.max(2, peak * 32);
                  return (
                    <rect
                      key={index}
                      x={index * 4}
                      y={(40 - height) / 2}
                      width={2}
                      height={height}
                      rx={1}
                      className={
                        (index / peaks.length) * 100 <= progress
                          ? styles.playedBar
                          : styles.bar
                      }
                    />
                  );
                })}
              </svg>
            ) : (
              <div className={styles.track} data-waveform="unavailable">
                <span style={{ width: `${progress}%` }} />
              </div>
            )}
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.1}
              value={Math.min(elapsed, duration || 0)}
              disabled={!duration}
              aria-label={`Seek ${name}`}
              aria-valuetext={`${timestamp(elapsed)} of ${duration ? timestamp(duration) : "unknown duration"}`}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (audio.current) {
                  audio.current.currentTime = value;
                  setElapsed(value);
                }
              }}
            />
          </div>
          <span className={styles.time} aria-label="Playback time">
            {timestamp(elapsed)} / {duration ? timestamp(duration) : "–:–"}
          </span>
        </div>
        <button
          type="button"
          className={styles.rate}
          aria-label={`Playback speed ${rate}×`}
          title="Change playback speed"
          onClick={() => {
            const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
            if (audio.current) audio.current.playbackRate = next;
            setRate(next);
          }}
        >
          {rate}×
        </button>
        <a
          className={styles.download}
          href={src}
          download={name}
          aria-label={`Download ${name}`}
          title={`Download ${name}`}
        >
          <ArrowDownToLine size={20} />
        </a>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

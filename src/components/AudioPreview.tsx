"use client";

import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { announceAudioPlayback } from "./AudioPlayer";

/** Native preview controls share playback ownership with message players. */
export default function AudioPreview({
  src,
  onPlay,
  ...attributes
}: ComponentPropsWithoutRef<"audio">) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    // Capture the element while mounted: React clears its ref on removal.
    const element = audio.current;
    return () => element?.pause();
  }, [src]);
  return (
    <audio
      {...attributes}
      ref={audio}
      src={src}
      onPlay={(event) => {
        announceAudioPlayback(event.currentTarget);
        onPlay?.(event);
      }}
    />
  );
}

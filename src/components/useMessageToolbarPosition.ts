'use client';

import { useCallback, useEffect, useRef } from 'react';

/** Keep only the active floating toolbar inside its scroll viewport. */
export function useMessageToolbarPosition() {
  const cancel = useRef<() => void>(() => undefined);
  useEffect(() => () => cancel.current(), []);
  return useCallback((row: HTMLElement) => {
    cancel.current();
    const toolbar = row.querySelector<HTMLElement>(':scope > .message-actions');
    const scroller = row.closest<HTMLElement>('.messages-scroll');
    if (!toolbar || !scroller || row.classList.contains('compact-message')) return;
    const desktop = window.matchMedia('(min-width: 800px) and (pointer: fine)');
    let frame = 0;
    let previous = '';
    const stop = () => {
      window.cancelAnimationFrame(frame);
      if (cancel.current === stop) cancel.current = () => undefined;
    };
    const place = () => {
      if (!row.isConnected || !desktop.matches) {
        toolbar.style.removeProperty('--message-actions-top');
        stop();
        return;
      }
      if (!row.matches(':hover, :focus-within')) {
        stop();
        return;
      }
      const bounds = scroller.getBoundingClientRect();
      const topEdge = bounds.top + scroller.clientTop;
      const rowTop = row.getBoundingClientRect().top;
      const toolbarHeight = toolbar.getBoundingClientRect().height;
      const top = Math.max(
        topEdge - rowTop,
        Math.min(-32, topEdge + scroller.clientHeight - rowTop - toolbarHeight),
      );
      const value = `${top}px`;
      if (value !== previous) {
        toolbar.style.setProperty('--message-actions-top', value);
        previous = value;
      }
      // Retain the final position when hidden so a menu's opener does not jump
      // as focus enters that menu. A later activation measures again.
      frame = window.requestAnimationFrame(place);
    };
    cancel.current = stop;
    place();
  }, []);
}

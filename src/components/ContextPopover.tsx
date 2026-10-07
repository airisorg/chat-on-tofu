"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import styles from "./ContextPopover.module.css";

export default function ContextPopover({
  title,
  children,
  anchor,
  onClose,
  variant = "menu",
  hideHeader = false,
}: {
  title: string;
  children: ReactNode;
  anchor?: HTMLElement | null;
  onClose: () => void;
  variant?: "menu" | "form" | "emoji" | "message";
  hideHeader?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const restoreFocus = useRef(true);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const positioned = position !== null;
  useLayoutEffect(() => { close.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    const place = () => {
      const element = panel.current;
      if (!element) return;
      const viewport = window.visualViewport;
      const topEdge = viewport?.offsetTop || 0;
      const leftEdge = viewport?.offsetLeft || 0;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const rect = anchor?.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      const maxHeight = Math.max(80, height - 24);
      const panelHeight = Math.min(box.height, maxHeight);
      const desiredLeft = rect
        ? variant === "form"
          ? rect.right + 8
          : rect.right - box.width
        : leftEdge + width - box.width - 12;
      const left = Math.max(
        leftEdge + 12,
        Math.min(desiredLeft, leftEdge + width - box.width - 12),
      );
      const below = rect
        ? variant === "form"
          ? rect.top
          : rect.bottom + 8
        : topEdge + 12;
      const top = Math.max(
        topEdge + 12,
        Math.min(
          below + panelHeight > topEdge + height - 12 && rect
            ? rect.top - panelHeight - 8
            : below,
          topEdge + height - panelHeight - 12,
        ),
      );
      setPosition(previous => previous?.left === left && previous.top === top && previous.maxHeight === maxHeight
        ? previous : { left, top, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    // An image, edited message or font can move an opener without resizing it
    // or the panel. Track just this open anchor, and only place on a change.
    let frame = 0;
    let previousAnchor = anchor?.getBoundingClientRect();
    const followAnchor = () => {
      if (!anchor) return;
      if (!anchor.isConnected) { close.current(); return; }
      const rect = anchor.getBoundingClientRect();
      if (!previousAnchor || rect.x !== previousAnchor.x || rect.y !== previousAnchor.y || rect.width !== previousAnchor.width || rect.height !== previousAnchor.height) {
        previousAnchor = rect;
        place();
      }
      frame = window.requestAnimationFrame(followAnchor);
    };
    if (anchor) frame = window.requestAnimationFrame(followAnchor);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [anchor, title, variant]);
  useEffect(() => {
    // The first render is hidden until measured. Browsers ignore a focus()
    // on that hidden input, so wait for the visible placement to commit.
    if (!positioned) return;
    restoreFocus.current = true;
    (
      panel.current?.querySelector<HTMLInputElement>("input") ||
      panel.current?.querySelector<HTMLButtonElement>("button:not([disabled])")
    )?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !anchor?.contains(event.target)
      ) {
        restoreFocus.current = false;
        onClose();
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (
          document.activeElement?.matches(
            "input, textarea, [role=combobox], [role=option]",
          )
        )
          return;
        const buttons = [
          ...(panel.current?.querySelectorAll<HTMLButtonElement>(
            "button:not([disabled])",
          ) || []),
        ];
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (current >= 0) {
          event.preventDefault();
          buttons[
            (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length
          ]?.focus();
        }
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    document.addEventListener("wheel", outside, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchmove", outside, {
      capture: true,
      passive: true,
    });
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
      document.removeEventListener("wheel", outside, true);
      document.removeEventListener("touchmove", outside, true);
      document.removeEventListener("keydown", keyboard);
      if (restoreFocus.current && anchor?.isConnected)
        anchor.focus({ preventScroll: true });
    };
  }, [anchor, onClose, title, positioned]);
  return (
    <div
      ref={panel}
      data-context-popover
      className={`${styles.panel} ${variant === "menu" ? "" : styles[variant]}`}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      style={position ? { ...position } : { visibility: "hidden" }}
    >
      {!hideHeader && (
        <div className={styles.header}>
          <span>{title}</span>
          <button type="button" aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

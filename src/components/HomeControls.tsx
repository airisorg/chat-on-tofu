"use client";

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import {
  Check, CheckCheck, ChevronDown, Hourglass, List, MessageSquare,
  MoreHorizontal, Pin, Users,
} from "lucide-react";
import ContextPopover from "./ContextPopover";
import { MaterialVerticalSplit } from "./MaterialIcons";
import styles from "./HomeControls.module.css";

export type HomeKind = "all" | "dm" | "space";

export default function HomeControls({
  unread, threads, kind, pinned, splitAvailable, splitEnabled, optionsRef,
  onUnreadChange, onThreadsChange, onKindChange, onPinnedChange,
  onReset, onSplitToggle, onReadAll,
}: {
  unread: boolean;
  threads: boolean;
  kind: HomeKind;
  pinned: boolean;
  splitAvailable: boolean;
  splitEnabled: boolean;
  optionsRef: RefObject<HTMLButtonElement | null>;
  onUnreadChange: (value: boolean) => void;
  onThreadsChange: (value: boolean) => void;
  onKindChange: (value: HomeKind) => void;
  onPinnedChange: (value: boolean) => void;
  onReset: () => void;
  onSplitToggle: (focusTarget?: HTMLButtonElement | null) => void;
  onReadAll: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState<"view" | "actions" | null>(null);
  const menuId = useId();
  const layoutToggle = useRef<HTMLButtonElement>(null);
  const layoutMenu = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(null), []);

  useEffect(() => {
    if (!splitAvailable && menuOpen === "view") {
      closeMenu();
      optionsRef.current?.focus({ preventScroll: true });
    }
  }, [splitAvailable, menuOpen, closeMenu, optionsRef]);

  const chooseView = (enabled: boolean) => {
    closeMenu();
    if (enabled !== splitEnabled) onSplitToggle(layoutMenu.current);
  };
  const chooseAction = (action: () => void) => {
    closeMenu();
    action();
  };
  const summary = [
    kind === "dm" ? "Direct messages" : kind === "space" ? "Spaces" : "",
    pinned ? "Pinned" : "",
  ].filter(Boolean).join(" · ");

  return (
    <>
      <header className={`home-header ${styles.header}`}>
        <h1>Home</h1>
        <div className={styles.controls} data-testid="home-controls">
          <button className={styles.unread} role="switch" aria-label="Unread"
            aria-checked={unread} onClick={() => onUnreadChange(!unread)}>
            <span>Unread</span>
            <span className={`${styles.track} ${unread ? styles.trackOn : ""}`} aria-hidden="true">
              <span className={styles.thumb}>{unread && <Check size={14} />}</span>
            </span>
          </button>
          <button className={`${styles.thread} ${threads ? styles.selected : ""}`}
            role="checkbox" aria-label="Threads" aria-checked={threads}
            onClick={() => onThreadsChange(!threads)}>
            <Hourglass size={18} aria-hidden="true" /><span>Thread</span>
          </button>
          {splitAvailable && (
            <div className={styles.layoutGroup} role="group" aria-label="Home layout">
              <button ref={layoutToggle} className={styles.layoutToggle}
                aria-label="Split pane" aria-pressed={splitEnabled}
                title={`Switch to ${splitEnabled ? "Single pane" : "Split pane"}`}
                onClick={() => {
                  closeMenu();
                  onSplitToggle(layoutToggle.current);
                }}>
                <MaterialVerticalSplit size={20} />
              </button>
              <button ref={layoutMenu} className={styles.layoutDropdown}
                aria-label="Home view options" aria-haspopup="menu"
                aria-expanded={menuOpen === "view"}
                aria-controls={menuOpen === "view" ? `${menuId}-view` : undefined}
                onClick={() => setMenuOpen(value => value === "view" ? null : "view")}
                onKeyDown={event => {
                  if (event.key === "ArrowDown") { event.preventDefault(); setMenuOpen("view"); }
                }}>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          <button ref={optionsRef} className={styles.actions}
            aria-label="More Home actions" aria-haspopup="menu"
            aria-expanded={menuOpen === "actions"}
            aria-controls={menuOpen === "actions" ? `${menuId}-actions` : undefined}
            onClick={() => setMenuOpen(value => value === "actions" ? null : "actions")}
            onKeyDown={event => {
              if (event.key === "ArrowDown") { event.preventDefault(); setMenuOpen("actions"); }
            }}>
            <MoreHorizontal size={20} aria-hidden="true" />
          </button>
        </div>
      </header>
      {summary && (
        <div className={styles.summary} aria-label="Active Home filters">
          <span>{summary}</span><button onClick={onReset}>Clear filters</button>
        </div>
      )}
      {menuOpen === "view" && splitAvailable && (
        <ContextPopover key="view" title="Home view options" anchor={layoutMenu.current}
          onClose={closeMenu} hideHeader className={styles.viewPanel}>
          <div id={`${menuId}-view`} className={`${styles.menu} ${styles.viewMenu}`} role="menu" aria-label="Home view options">
            <button role="menuitemradio" aria-checked={splitEnabled} onClick={() => chooseView(true)}>
              <MaterialVerticalSplit size={18} /><span>Split pane</span>
              <Check className={styles.check} size={18} aria-hidden="true" />
            </button>
            <button role="menuitemradio" aria-checked={!splitEnabled} onClick={() => chooseView(false)}>
              <List size={18} aria-hidden="true" /><span>Single pane</span>
              <Check className={styles.check} size={18} aria-hidden="true" />
            </button>
          </div>
        </ContextPopover>
      )}
      {menuOpen === "actions" && (
        <ContextPopover key="actions" title="More Home actions" anchor={optionsRef.current}
          onClose={closeMenu} hideHeader>
          <div id={`${menuId}-actions`} className={styles.menu} role="menu" aria-label="More Home actions">
            <button role="menuitem" onClick={() => chooseAction(onReset)}>
              <MessageSquare size={18} aria-hidden="true" /><span>All conversations</span>
            </button>
            <button role="menuitemradio" aria-checked={kind === "dm"}
              onClick={() => chooseAction(() => onKindChange("dm"))}>
              <Users size={18} aria-hidden="true" /><span>Direct messages</span>
              <Check className={styles.check} size={18} aria-hidden="true" />
            </button>
            <button role="menuitemradio" aria-checked={kind === "space"}
              onClick={() => chooseAction(() => onKindChange("space"))}>
              <MessageSquare size={18} aria-hidden="true" /><span>Spaces</span>
              <Check className={styles.check} size={18} aria-hidden="true" />
            </button>
            <button role="menuitemcheckbox" aria-checked={pinned}
              onClick={() => chooseAction(() => onPinnedChange(!pinned))}>
              <Pin size={18} aria-hidden="true" /><span>Pinned</span>
              <Check className={styles.check} size={18} aria-hidden="true" />
            </button>
            <div className={styles.divider} role="separator" />
            <button role="menuitem" onClick={() => chooseAction(onReadAll)}>
              <CheckCheck size={18} aria-hidden="true" /><span>Mark all conversations read</span>
            </button>
          </div>
        </ContextPopover>
      )}
    </>
  );
}

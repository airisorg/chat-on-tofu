"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Ellipsis,
  File,
  Hash,
  Home,
  Info,
  Link,
  LogOut,
  Menu,
  Mic,
  MessageCircle,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  Search,
  SendHorizontal,
  Settings,
  Smile,
  Star,
  Trash2,
  Users,
  Video,
  X,
  AtSign,
  Folder,
  Palette,
  Smartphone,
  CheckCheck,
} from "lucide-react";
import { useChat } from "@/lib/use-chat";
import VoiceRecorder from "./VoiceRecorder";
import InstallHelp from "./InstallHelp";
import { isCompactViewport } from "./platform";
import type {
  Attachment,
  ChatAction,
  Conversation,
  Message,
  Person,
} from "@/lib/types";

type View =
  | "home"
  | "direct"
  | "spaces"
  | "mentions"
  | "starred"
  | "sections"
  | "search";
type Modal =
  | { type: "new"; kind: Conversation["kind"] }
  | { type: "settings" | "profile" | "install" | "more" | "voice" }
  | {
      type: "conversation" | "invite" | "about" | "leave";
      conversation: Conversation;
    }
  | { type: "message" | "edit" | "delete" | "emoji"; message: Message }
  | { type: "attachment"; attachment: Attachment }
  | null;
const EMOJI = [
  "👍",
  "❤️",
  "😂",
  "🎉",
  "✅",
  "👀",
  "🙌",
  "💡",
  "🔥",
  "🙏",
  "✨",
  "😊",
];
const names: Record<View, string> = {
  home: "Home",
  direct: "Direct messages",
  spaces: "Spaces",
  mentions: "Mentions",
  starred: "Starred",
  sections: "Sections",
  search: "Search results",
};
function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
}
function time(date: string) {
  return new Date(date).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
function dateLabel(date: string) {
  const d = new Date(date);
  return d.toDateString() === new Date().toDateString()
    ? "Today"
    : d.toLocaleDateString([], { month: "long", day: "numeric" });
}
function Avatar({
  person,
  size = "",
  online = false,
}: {
  person: Person;
  size?: string;
  online?: boolean;
}) {
  const hex = (person.color || "#c2e7ff").replace("#", "");
  const dark =
    hex.length === 6 &&
    parseInt(hex.slice(0, 2), 16) * 0.299 +
      parseInt(hex.slice(2, 4), 16) * 0.587 +
      parseInt(hex.slice(4, 6), 16) * 0.114 <
      150;
  return (
    <span
      className={`avatar ${size}`}
      style={{
        background: person.color || "#c2e7ff",
        color: dark ? "#fff" : "#183650",
      }}
    >
      {person.avatar ? (
        <img src={person.avatar} alt="" referrerPolicy="no-referrer" />
      ) : (
        initials(person.name)
      )}
      {online && <span className="online-dot" />}
    </span>
  );
}
function ConversationAvatar({
  conversation,
  small = false,
  userId,
}: {
  conversation: Conversation;
  small?: boolean;
  userId?: string;
}) {
  return conversation.kind === "dm" ? (
    <Avatar
      person={
        conversation.members.find((p) => p.id !== userId) || {
          id: "",
          name: conversation.name,
          email: "",
        }
      }
      size={small ? "small" : ""}
      online
    />
  ) : (
    <span
      className={`space-avatar ${small ? "small" : ""}`}
      style={{
        background: conversation.kind === "space" ? "#d3e3fd" : "#c4eed0",
      }}
    >
      {conversation.kind === "space" ? (
        <Hash size={small ? 17 : 22} />
      ) : (
        <Users size={small ? 17 : 22} />
      )}
    </span>
  );
}
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? "compact" : ""}`}>
      <span className="brand-mark">
        <MessageSquare size={compact ? 23 : 28} strokeWidth={2.6} />
        <span />
      </span>
      {!compact && <span>Chat</span>}
    </span>
  );
}
function IconButton({
  label,
  children,
  className = "",
  onClick,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    const nodes = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input, select, textarea, a[href]",
        ) || [],
      );
    const first = nodes().find((x) => x.tagName === "INPUT") || nodes()[0];
    first?.focus();
    function key(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const elements = nodes();
        if (!elements.length) return;
        const start = elements[0],
          end = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === start) {
          event.preventDefault();
          end.focus();
        } else if (!event.shiftKey && document.activeElement === end) {
          event.preventDefault();
          start.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose, title]);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`dialog ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="dialog-header">
          <h2 id="dialog-title">{title}</h2>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={22} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ChatApp() {
  const chat = useChat();
  const demoAvailable =
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_ENABLE_DEMO === "true";
  const [view, setView] = useState<View>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [searchScope, setSearchScope] = useState<string | null>(null);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const atBottom = useRef(true);
  const [modal, setModal] = useState<Modal>(null);
  const [draft, setDraft] = useState("");
  const [threadDraft, setThreadDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState("system");
  const [themeReady, setThemeReady] = useState(false);
  const [requestedInvitation, setRequestedInvitation] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<
    (Event & { prompt: () => Promise<void> }) | null
  >(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadComposerRef = useRef<HTMLTextAreaElement>(null);
  const previousUser = useRef<string | null>(null);
  const closeModal = useCallback(() => setModal(null), []);
  const draftMap = useRef<
    Record<string, { text: string; attachments: Attachment[] }>
  >({});
  const threadDraftMap = useRef<Record<string, string>>({});
  const draftOwner = useRef<string | null>(null);
  const [renderedDraftOwner, setRenderedDraftOwner] = useState<string | null>(
    null,
  );
  const state = chat.state;
  const selected = state?.conversations.find((c) => c.id === selectedId);
  const messages =
    state?.messages.filter(
      (m) => m.conversationId === selectedId && !m.parentId,
    ) || [];
  const thread = state?.messages.find((m) => m.id === threadId);
  const replies = state?.messages.filter((m) => m.parentId === threadId) || [];
  const sectionNames = [
    ...new Set(
      state?.conversations.map((c) => c.section).filter(Boolean) || [],
    ),
  ];
  useEffect(() => {
    try {
      const saved = localStorage.getItem("relay-theme");
      if (saved && ["system", "light", "dark"].includes(saved)) setTheme(saved);
    } catch {
      /* Storage can be blocked by browser privacy settings. */
    }
    setThemeReady(true);
    try {
      const invitation = new URLSearchParams(window.location.search).get(
        "join",
      );
      if (invitation)
        sessionStorage.setItem(
          "chat-pending-invitation",
          invitation.slice(0, 120),
        );
      setRequestedInvitation(
        sessionStorage.getItem("chat-pending-invitation") || "",
      );
    } catch {}
    const listener = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener("beforeinstallprompt", listener);
    return () => window.removeEventListener("beforeinstallprompt", listener);
  }, []);
  useEffect(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (dark.matches ? "dark" : "light") : theme);
    apply();
    dark.addEventListener("change", apply);
    if (themeReady) {
      try {
        localStorage.setItem("relay-theme", theme);
      } catch {
        /* Appearance still works for this visit. */
      }
    }
    return () => dark.removeEventListener("change", apply);
  }, [theme, themeReady]);
  useEffect(() => {
    const userId = state?.user.id || null;
    if (previousUser.current === userId) return;
    if (previousUser.current) {
      try {
        localStorage.removeItem(`relay-drafts:${previousUser.current}`);
      } catch {}
    }
    previousUser.current = userId;
    draftOwner.current = userId;
    setRenderedDraftOwner(userId);
    draftMap.current = {};
    threadDraftMap.current = {};
    setDraft("");
    setAttachments([]);
    setThreadDraft("");
    setThreadId(null);
    setSelectedId(null);
    setQuery("");
    setSearchScope(null);
    setJumpTarget(null);
    setEmojiOpen(false);
    setModal(null);
    if (userId && state) {
      try {
        const stored = localStorage.getItem(`relay-drafts:${userId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === "object") draftMap.current = parsed;
        }
      } catch {}
      let invitation = "";
      try {
        invitation = sessionStorage.getItem("chat-pending-invitation") || "";
      } catch {}
      const invitedConversation = state.conversations.find(
        (c) => c.id === invitation,
      );
      if (invitedConversation || !isCompactViewport()) {
        const initial =
          invitedConversation ||
          (chat.demo
            ? state.conversations.find((c) => /design/i.test(c.name))
            : undefined) ||
          state.conversations[0];
        if (initial) {
          setSelectedId(initial.id);
          setDraft(draftMap.current[initial.id]?.text || "");
          setAttachments(draftMap.current[initial.id]?.attachments || []);
        }
      }
      if (invitedConversation) {
        try {
          sessionStorage.removeItem("chat-pending-invitation");
        } catch {}
        setRequestedInvitation("");
      } else if (invitation && !chat.demo) {
        setToast(
          "Ask your friend to add your Google email to this conversation, then refresh.",
        );
      }
    }
  }, [state]);
  useEffect(() => {
    if (
      !selectedId ||
      !state ||
      draftOwner.current !== state.user.id ||
      renderedDraftOwner !== state.user.id
    )
      return;
    draftMap.current[selectedId] = { text: draft, attachments };
    try {
      localStorage.setItem(
        `relay-drafts:${state.user.id}`,
        JSON.stringify(draftMap.current),
      );
    } catch {
      try {
        localStorage.setItem(
          `relay-drafts:${state.user.id}`,
          JSON.stringify(
            Object.fromEntries(
              Object.entries(draftMap.current).map(([id, d]) => [
                id,
                { text: d.text, attachments: [] },
              ]),
            ),
          ),
        );
      } catch {}
    }
  }, [draft, attachments, selectedId, state?.user.id, renderedDraftOwner]);
  useEffect(() => {
    if (threadId) setThreadDraft(threadDraftMap.current[threadId] || "");
    else setThreadDraft("");
  }, [threadId]);
  useEffect(() => {
    const input = composerRef.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, isCompactViewport() ? 110 : 140)}px`;
    }
  }, [draft, selectedId]);
  useEffect(() => {
    const input = threadComposerRef.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
    }
  }, [threadDraft, threadId]);
  function updateThreadDraft(text: string) {
    setThreadDraft(text);
    if (threadId) threadDraftMap.current[threadId] = text;
  }
  useEffect(() => {
    atBottom.current = true;
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [selectedId]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && atBottom.current)
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
  }, [messages.length]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [selectedId]);
  useEffect(() => {
    if (!jumpTarget || !selectedId) return;
    const timer = window.setTimeout(() => {
      document
        .getElementById(`message-${jumpTarget}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    const clear = window.setTimeout(() => setJumpTarget(null), 2500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clear);
    };
  }, [selectedId, jumpTarget]);
  useEffect(() => {
    if (
      selectedId &&
      state &&
      !state.conversations.some((c) => c.id === selectedId)
    ) {
      setSelectedId(null);
      setThreadId(null);
    }
  }, [selectedId, state]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    function shortcut(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  async function act(action: ChatAction, success?: string) {
    try {
      const result = await chat.action(action);
      if (success) setToast(success);
      return result;
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
      );
      throw error;
    }
  }
  function run(action: ChatAction, success?: string) {
    void act(action, success).catch(() => {});
  }
  function openConversation(conversation: Conversation) {
    setSelectedId(conversation.id);
    setThreadId(null);
    setDraft(draftMap.current[conversation.id]?.text || "");
    setAttachments(draftMap.current[conversation.id]?.attachments || []);
    setEmojiOpen(false);
    setQuery("");
    setSearchScope(null);
    if (conversation.unread)
      run({ type: "read", conversationId: conversation.id });
  }
  function navigate(next: View) {
    setView(next);
    setSelectedId(null);
    setThreadId(null);
    setQuery("");
    setSearchScope(null);
    setUnreadOnly(false);
    setPinnedOnly(false);
  }
  async function send(inThread = false) {
    const text = inThread ? threadDraft : draft;
    if (
      !selected ||
      sending ||
      (!text.trim() && (!attachments.length || inThread))
    )
      return;
    setSending(true);
    atBottom.current = true;
    try {
      await act({
        type: "send",
        conversationId: selected.id,
        text: text.trim(),
        ...(inThread && threadId ? { parentId: threadId } : {}),
        attachments: inThread ? [] : attachments,
      });
      if (inThread) updateThreadDraft("");
      else {
        setDraft("");
        setAttachments([]);
      }
      composerRef.current?.focus();
    } catch {
    } finally {
      setSending(false);
    }
  }
  function composeKey(
    event: KeyboardEvent<HTMLTextAreaElement>,
    inThread = false,
  ) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void send(inThread);
    }
  }
  async function addFiles(files: FileList | null) {
    if (!files) return;
    const incoming: Attachment[] = [];
    for (const f of Array.from(files)) {
      const rawType = f.type.toLowerCase().split(";")[0];
      const type =
        rawType === "audio/x-m4a" ||
        rawType === "audio/m4a" ||
        (!rawType && /\.m4a$/i.test(f.name))
          ? "audio/mp4"
          : rawType === "audio/x-wav"
            ? "audio/wav"
            : rawType;
      if (f.size > 1024 * 1024) {
        setToast(`${f.name} is too large. Choose a file under 1 MB.`);
        continue;
      }
      if (attachments.length + incoming.length >= 3) {
        setToast("You can attach up to 3 files per message.");
        break;
      }
      if (
        !/^(image\/(png|jpeg|gif|webp)|text\/plain|application\/pdf|audio\/(webm|mp4|ogg|mpeg|wav))$/.test(
          type,
        )
      ) {
        setToast(
          "Choose a PNG, JPG, GIF, WebP image, text file, PDF, or audio file.",
        );
        continue;
      }
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(f);
      });
      incoming.push({
        name: f.name,
        type,
        size: f.size,
        url: url.replace(/^data:[^;]+;/, `data:${type};`),
      });
    }
    setAttachments((current) => [...current, ...incoming]);
    if (fileRef.current) fileRef.current.value = "";
  }
  async function copyInvitation(conversation: Conversation) {
    const url = `${location.origin}/?join=${encodeURIComponent(conversation.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast(
        "Invitation link copied. Share it with your friend and ask them to sign in with the email you added.",
      );
    } catch {
      setToast(`Invitation link: ${url}`);
    }
  }
  async function shareInvitation(conversation: Conversation) {
    if (!navigator.share) {
      await copyInvitation(conversation);
      return;
    }
    try {
      await navigator.share({
        title: `Join ${conversation.name} in Chat`,
        text: "Join me in Chat. Sign in with Google using the email I added to our conversation.",
        url: `${location.origin}/?join=${encodeURIComponent(conversation.id)}`,
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        await copyInvitation(conversation);
    }
  }
  async function submitNew(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (modal?.type !== "new") return;
    const data = new FormData(e.currentTarget);
    const kind = modal.kind;
    const name = String(data.get("name") || "").trim();
    const emails = String(data.get("emails") || "")
      .split(/[,\s]+/)
      .filter(Boolean);
    setBusy(true);
    try {
      const id = await act({
        type: "create",
        name,
        kind,
        emails,
        description: String(data.get("description") || ""),
      });
      setModal(null);
      if (id) {
        setSelectedId(id);
        setThreadId(null);
        setDraft("");
        setAttachments([]);
      }
      setToast(kind === "space" ? "Space created" : "Conversation started");
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function submitProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await act(
        {
          type: "profile",
          name: String(data.get("name") || ""),
          status: String(data.get("status") || ""),
        },
        "Profile updated",
      );
      setModal(null);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function submitConversation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (modal?.type !== "conversation") return;
    const data = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await act(
        {
          type: "conversation",
          conversationId: modal.conversation.id,
          name: String(data.get("name") || ""),
          description: String(data.get("description") || ""),
          section: String(data.get("section") || ""),
        },
        "Conversation updated",
      );
      setModal(null);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  function showMessage(message: Message) {
    setModal({ type: "message", message });
  }
  function messageRow(message: Message, compact = false) {
    const count =
      state?.messages.filter((m) => m.parentId === message.id).length || 0;
    return (
      <article
        id={`message-${message.id}`}
        className={`message ${jumpTarget === message.id ? "message-highlight" : ""} ${compact ? "compact-message" : ""}`}
        key={message.id}
      >
        <Avatar person={message.author} />
        <div className="message-body">
          <div className="message-meta">
            <strong>{message.author.name}</strong>
            <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
            {message.edited && <span className="edited">Edited</span>}
            {message.starred && <Star size={13} className="star-fill" />}
          </div>
          {message.deleted ? (
            <p className="deleted-message">This message was deleted</p>
          ) : (
            <>
              <div className="message-text">{message.text}</div>
              {message.attachments.length > 0 && (
                <div className="message-attachments">
                  {message.attachments.map((attachment, i) =>
                    attachment.type.startsWith("audio/") ? (
                      <div className="audio-attachment" key={i}>
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
                        key={i}
                        href={attachment.url}
                        download={attachment.name}
                        aria-haspopup={
                          attachment.type.startsWith("image/")
                            ? "dialog"
                            : undefined
                        }
                        onClick={
                          attachment.type.startsWith("image/")
                            ? (e) => {
                                e.preventDefault();
                                setModal({ type: "attachment", attachment });
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
                            {Math.max(1, Math.round(attachment.size / 1024))} KB
                            · Download
                          </small>
                        </span>
                      </a>
                    ),
                  )}
                </div>
              )}
              {message.reactions.length > 0 && (
                <div className="reaction-list">
                  {message.reactions
                    .filter((r) => r.userIds.length)
                    .map((r) => (
                      <button
                        key={r.emoji}
                        className={`reaction ${r.userIds.includes(state!.user.id) ? "mine" : ""}`}
                        onClick={() =>
                          run({
                            type: "react",
                            messageId: message.id,
                            emoji: r.emoji,
                          })
                        }
                        aria-label={`${r.emoji}, ${r.userIds.length} reaction${r.userIds.length === 1 ? "" : "s"}. Toggle your reaction.`}
                      >
                        {r.emoji}
                        <span>{r.userIds.length}</span>
                      </button>
                    ))}
                </div>
              )}
              {count > 0 && !compact && (
                <button
                  className="thread-link"
                  onClick={() => setThreadId(message.id)}
                >
                  <MessageSquare size={15} />
                  {count} {count === 1 ? "reply" : "replies"}
                  <ChevronRight size={15} />
                </button>
              )}
            </>
          )}
        </div>
        {!message.deleted && (
          <div className="message-actions">
            <IconButton
              label="Add reaction"
              onClick={() => setModal({ type: "emoji", message })}
            >
              <Smile size={18} />
            </IconButton>
            {!compact && (
              <IconButton
                label="Reply in thread"
                onClick={() => setThreadId(message.id)}
              >
                <MessageSquare size={18} />
              </IconButton>
            )}
            <IconButton
              label={message.starred ? "Unstar message" : "Star message"}
              onClick={() => run({ type: "star", messageId: message.id })}
            >
              <Star size={18} className={message.starred ? "star-fill" : ""} />
            </IconButton>
            <IconButton
              label="More actions"
              onClick={() => showMessage(message)}
            >
              <Ellipsis size={18} />
            </IconButton>
          </div>
        )}
      </article>
    );
  }
  const toastUI = (
    <>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
          <IconButton label="Dismiss notification" onClick={() => setToast("")}>
            <X size={18} />
          </IconButton>
        </div>
      )}
      {chat.error && (
        <div className="error-banner" role="alert">
          <Info size={18} />
          <span>{chat.error}</span>
          <IconButton label="Dismiss error" onClick={chat.clearError}>
            <X size={18} />
          </IconButton>
        </div>
      )}
    </>
  );
  if (chat.loading && !state)
    return (
      <div className="loading-screen">
        <Brand />
        <span className="loader" />
        <p>Getting your conversations ready…</p>
      </div>
    );
  if (!state)
    return (
      <main className="welcome">
        <div className="welcome-header">
          <Brand />
          <span>Room for every conversation.</span>
        </div>
        <section className="welcome-content">
          <div className="welcome-copy">
            <span className="eyebrow">
              <span /> A familiar space to connect
            </span>
            <h1>
              Welcome to Chat.
              <br />
              <span>Stay close. Go further.</span>
            </h1>
            {requestedInvitation && (
              <div className="invitation-welcome">
                <Users size={20} />
                <span>
                  You’re invited. Continue with Google using the email your
                  friend added to the conversation.
                </span>
              </div>
            )}
            <p>
              Bring your people together in one calm, organized place. A chat
              experience built for your team, and the way you move.
            </p>
            <button
              className="google-button"
              onClick={chat.signIn}
              disabled={!chat.authAvailable}
            >
              <svg
                viewBox="0 0 48 48"
                width="20"
                height="20"
                aria-hidden="true"
              >
                <path
                  fill="#4285F4"
                  d="M43.6 24.5c0-1.4-.1-2.8-.4-4.2H24v8h11a9.4 9.4 0 0 1-4.1 6.2v5.2h6.6c3.9-3.6 6.1-8.9 6.1-15.2Z"
                />
                <path
                  fill="#34A853"
                  d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.2a12.3 12.3 0 0 1-18.3-6.5H5.8v5.4A20 20 0 0 0 24 44Z"
                />
                <path
                  fill="#FBBC05"
                  d="M12.6 27.4a12 12 0 0 1 0-7.7v-5.4H5.8a20 20 0 0 0 0 18.5l6.8-5.4Z"
                />
                <path
                  fill="#EA4335"
                  d="M24 12c3 0 5.5 1 7.6 3l5.7-5.7A19.2 19.2 0 0 0 24 4 20 20 0 0 0 5.8 14.3l6.8 5.4A12 12 0 0 1 24 12Z"
                />
              </svg>
              Continue with Google
              <ArrowUpRight size={18} />
            </button>
            {!chat.authAvailable && (
              <p className="auth-note">
                {demoAvailable
                  ? "Google sign-in is being configured. Explore the local preview while we finish connecting it."
                  : "Google sign-in is temporarily unavailable. Please refresh and try again."}
              </p>
            )}
            {demoAvailable && (
              <button className="demo-button" onClick={chat.startDemo}>
                Explore demo <ArrowUpRight size={18} />
              </button>
            )}
            <div className="welcome-benefits">
              <span>
                <Check size={16} /> Messages & spaces
              </span>
              <span>
                <Check size={16} /> Made for iPhone
              </span>
              <span>
                <Check size={16} /> Install to Home Screen
              </span>
            </div>
          </div>
          <div className="welcome-preview">
            <div className="preview-top">
              <span className="preview-dots">
                <i />
                <i />
                <i />
              </span>
              <span>Design team</span>
              <Ellipsis size={20} />
            </div>
            <div className="preview-space">
              <span className="preview-space-icon">
                <Hash size={27} />
              </span>
              <div>
                <strong>A little space for big ideas.</strong>
                <p>Keep the conversation going.</p>
              </div>
            </div>
            <div className="preview-message">
              <Avatar
                person={{
                  id: "",
                  name: "Maya Chen",
                  email: "",
                  color: "#ead7f8",
                }}
              />
              <div>
                <strong>
                  Maya Chen <small>10:42 AM</small>
                </strong>
                <p>
                  Love where this is going. Ready to share the first look? ✨
                </p>
                <span className="preview-reaction">🙌 3</span>
              </div>
            </div>
            <div className="preview-message">
              <Avatar
                person={{
                  id: "",
                  name: "Alex Rivera",
                  email: "",
                  color: "#c4eed0",
                }}
              />
              <div>
                <strong>
                  Alex Rivera <small>10:43 AM</small>
                </strong>
                <p>Absolutely. A fresh start for all of us.</p>
              </div>
            </div>
            <div className="preview-composer">
              Message Design team
              <Smile size={20} />
              <SendHorizontal size={20} />
            </div>
            <span className="preview-floating">
              <Smartphone size={19} /> Your team, wherever you are
            </span>
          </div>
        </section>
        <footer className="welcome-footer">
          Your conversations are private to this app.
        </footer>
        {toastUI}
      </main>
    );

  const visibleConversations = state.conversations
    .filter(
      (c) =>
        (!unreadOnly || c.unread > 0) &&
        (!pinnedOnly || c.pinned) &&
        (!searchScope || c.id === searchScope) &&
        (view !== "direct" || c.kind !== "space") &&
        (view !== "spaces" || c.kind === "space") &&
        (!query ||
          `${c.name} ${c.lastMessage || ""} ${c.description || ""}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    )
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  const foundMessages = state.messages.filter(
    (m) =>
      !m.deleted &&
      (!searchScope || m.conversationId === searchScope) &&
      (!unreadOnly ||
        state.conversations.some(
          (c) => c.id === m.conversationId && c.unread > 0,
        )) &&
      (view === "starred"
        ? m.starred
        : view === "mentions"
          ? m.text.toLowerCase().includes("@all") ||
            m.text
              .toLowerCase()
              .includes(`@${state.user.name.split(" ")[0].toLowerCase()}`) ||
            m.text.toLowerCase().includes(`@${state.user.email.toLowerCase()}`)
          : query && m.text.toLowerCase().includes(query.toLowerCase())),
  );
  const navItems: {
    view: View;
    icon: ReactNode;
    label: string;
    count?: number;
  }[] = [
    {
      view: "home",
      icon: <Home size={20} />,
      label: "Home",
      count: state.conversations.reduce((a, c) => a + c.unread, 0),
    },
    { view: "mentions", icon: <AtSign size={20} />, label: "Mentions" },
    { view: "starred", icon: <Star size={20} />, label: "Starred" },
  ];
  const composer = (inThread = false) => (
    <div className={`composer-wrap ${inThread ? "thread-composer-wrap" : ""}`}>
      {!inThread && attachments.length > 0 && (
        <div className="draft-attachments">
          {attachments.map((f, i) => (
            <span key={i}>
              {f.type.startsWith("audio/") ? (
                <Mic size={15} />
              ) : (
                <File size={15} />
              )}
              {f.name}
              {f.type.startsWith("audio/") && (
                <audio
                  className="draft-audio"
                  controls
                  src={f.url}
                  aria-label="Voice note preview"
                />
              )}
              <IconButton
                label={`Remove ${f.name}`}
                onClick={() =>
                  setAttachments((files) => files.filter((_, j) => i !== j))
                }
              >
                <X size={14} />
              </IconButton>
            </span>
          ))}
        </div>
      )}
      <div className="composer">
        <textarea
          ref={inThread ? threadComposerRef : composerRef}
          value={inThread ? threadDraft : draft}
          onChange={(e) =>
            inThread
              ? updateThreadDraft(e.target.value)
              : setDraft(e.target.value)
          }
          onKeyDown={(e) => composeKey(e, inThread)}
          placeholder={
            inThread ? "Reply in thread" : `Message ${selected?.name || ""}`
          }
          rows={1}
          maxLength={6000}
          aria-label={inThread ? "Reply in thread" : "Message"}
        />
        <div className="composer-controls">
          {!inThread && (
            <>
              <IconButton
                label="Add emoji"
                className={emojiOpen ? "active" : ""}
                onClick={() => setEmojiOpen(!emojiOpen)}
              >
                <Smile size={22} />
              </IconButton>
              <IconButton
                label="Record voice note"
                onClick={() => setModal({ type: "voice" })}
              >
                <Mic size={21} />
              </IconButton>
              <IconButton
                label="Attach files (up to 1 MB each)"
                onClick={() => fileRef.current?.click()}
              >
                <Plus size={24} />
              </IconButton>
            </>
          )}
          <button
            type="button"
            className="send-button"
            aria-label={inThread ? "Send reply" : "Send message"}
            title="Send message"
            disabled={
              sending ||
              !(inThread
                ? threadDraft.trim()
                : draft.trim() || attachments.length)
            }
            onClick={() => void send(inThread)}
          >
            <SendHorizontal size={22} />
          </button>
        </div>
      </div>
      {!inThread && emojiOpen && (
        <div className="composer-emoji">
          {EMOJI.map((emoji) => (
            <button
              key={emoji}
              aria-label={`Insert ${emoji}`}
              onClick={() => {
                setDraft(draft + emoji);
                setEmojiOpen(false);
                composerRef.current?.focus();
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      {!inThread && (
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,text/plain,application/pdf,audio/webm,audio/mp4,audio/ogg,audio/mpeg,audio/wav,audio/x-m4a,audio/x-wav,.m4a"
          hidden
          multiple
          ref={fileRef}
          onChange={(e) => void addFiles(e.target.files)}
        />
      )}
      {!inThread && (
        <p className="composer-hint">
          Enter to send · Shift + Enter for a new line
        </p>
      )}
    </div>
  );

  return (
    <div
      className={`app-shell ${selected ? "conversation-open" : ""} ${thread ? "thread-open" : ""}`}
      onClickCapture={(event) => {
        // Safari does not focus clicked buttons by default. Establish the
        // trigger before opening a dialog so Escape restores a useful target.
        const button =
          event.target instanceof Element
            ? event.target.closest("button")
            : null;
        button?.focus({ preventScroll: true });
      }}
    >
      <a href="#main-content" className="skip-link">
        Skip to conversation
      </a>
      <aside className="app-rail" aria-label="App shortcuts">
        <IconButton
          label="Open navigation home"
          onClick={() => navigate("home")}
        >
          <Menu size={24} />
        </IconButton>
        <button
          className="rail-chat"
          onClick={() => navigate("home")}
          aria-label="Chat"
        >
          <MessageCircle size={25} />
          <small>Chat</small>
        </button>
        <div className="rail-bottom">
          <IconButton
            label="Add Chat to Home Screen"
            onClick={() => setModal({ type: "install" })}
          >
            <Smartphone size={23} />
          </IconButton>
        </div>
      </aside>
      <header className="app-topbar">
        <Brand />
        <form
          className="search-box"
          onSubmit={(e) => {
            e.preventDefault();
            setView("search");
            setSelectedId(null);
          }}
        >
          <Search size={22} />
          <input
            ref={searchRef}
            aria-label="Search in chat"
            placeholder={
              searchScope
                ? `Search ${state.conversations.find((c) => c.id === searchScope)?.name || "conversation"}`
                : "Search in chat"
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value) {
                setView("search");
                setSelectedId(null);
              }
            }}
          />
          {query && (
            <IconButton
              label="Clear search"
              onClick={() => {
                setQuery("");
                setSearchScope(null);
                setView("home");
              }}
            >
              <X size={19} />
            </IconButton>
          )}
          <span className="search-shortcut">⌘ K</span>
        </form>
        <div className="topbar-actions">
          <button
            className="status-button"
            onClick={() => setModal({ type: "profile" })}
          >
            <span
              className={`status-dot ${state.user.status === "Do not disturb" ? "dnd" : state.user.status === "Away" ? "away" : ""}`}
            />
            {state.user.status === "Do not disturb"
              ? "Do not disturb"
              : state.user.status === "Away"
                ? "Away"
                : "Active"}
            <ChevronDown size={16} />
          </button>
          <IconButton
            label="Help and installation"
            onClick={() => setModal({ type: "install" })}
          >
            <CircleHelp size={23} />
          </IconButton>
          <IconButton
            label="Settings"
            onClick={() => setModal({ type: "settings" })}
          >
            <Settings size={23} />
          </IconButton>
          <button
            className="account-button"
            aria-label="Your profile"
            onClick={() => setModal({ type: "profile" })}
          >
            <Avatar person={state.user} size="small" />
          </button>
        </div>
      </header>
      <aside className="sidebar" aria-label="Chat navigation">
        <button
          className="new-chat-button"
          onClick={() => setModal({ type: "new", kind: "dm" })}
        >
          <Plus size={25} />
          New chat
        </button>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.view}
              aria-label={item.label}
              className={`nav-item ${!selected && view === item.view ? "selected" : ""}`}
              onClick={() => navigate(item.view)}
            >
              {item.icon}
              <span>{item.label}</span>
              {!!item.count && <span className="nav-count">{item.count}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-group">
          <div className="sidebar-group-heading">
            <button onClick={() => navigate("direct")}>
              <ChevronDown size={17} />
              Direct messages
            </button>
            <IconButton
              label="New direct message"
              onClick={() => setModal({ type: "new", kind: "dm" })}
            >
              <Plus size={19} />
            </IconButton>
          </div>
          {state.conversations
            .filter((c) => c.kind !== "space" && !c.section)
            .slice(0, 7)
            .map((c) => (
              <button
                key={c.id}
                aria-label={c.name}
                className={`sidebar-conversation ${selectedId === c.id ? "selected" : ""}`}
                onClick={() => openConversation(c)}
              >
                <ConversationAvatar
                  userId={state.user.id}
                  conversation={c}
                  small
                />
                <span className={c.unread ? "unread" : ""}>{c.name}</span>
                {c.muted && <BellOff size={13} />}
                {!!c.unread && <span className="unread-dot" />}
              </button>
            ))}
        </div>
        <div className="sidebar-group">
          <div className="sidebar-group-heading">
            <button onClick={() => navigate("spaces")}>
              <ChevronDown size={17} />
              Spaces
            </button>
            <IconButton
              label="New space"
              onClick={() => setModal({ type: "new", kind: "space" })}
            >
              <Plus size={19} />
            </IconButton>
          </div>
          {state.conversations
            .filter((c) => c.kind === "space" && !c.section)
            .map((c) => (
              <button
                key={c.id}
                aria-label={c.name}
                className={`sidebar-conversation ${selectedId === c.id ? "selected" : ""}`}
                onClick={() => openConversation(c)}
              >
                <ConversationAvatar
                  userId={state.user.id}
                  conversation={c}
                  small
                />
                <span className={c.unread ? "unread" : ""}>{c.name}</span>
                {c.pinned && <Pin size={13} />}
                {!!c.unread && <span className="unread-dot" />}
              </button>
            ))}
        </div>
        {sectionNames.map((section) => (
          <div className="sidebar-group" key={section}>
            <div className="sidebar-group-heading">
              <button onClick={() => navigate("sections")}>
                <ChevronDown size={17} />
                {section}
              </button>
            </div>
            {state.conversations
              .filter((c) => c.section === section)
              .map((c) => (
                <button
                  aria-label={c.name}
                  className={`sidebar-conversation ${selectedId === c.id ? "selected" : ""}`}
                  key={c.id}
                  onClick={() => openConversation(c)}
                >
                  <ConversationAvatar
                    userId={state.user.id}
                    conversation={c}
                    small
                  />
                  <span>{c.name}</span>
                </button>
              ))}
          </div>
        ))}
        <div className="sidebar-footer">
          {chat.demo && <span className="demo-badge">DEMO WORKSPACE</span>}
          <span>
            <span
              className={`connection-dot ${chat.offline ? "offline" : ""}`}
            />
            {chat.offline
              ? "Offline · saved on this device"
              : chat.demo
                ? "Changes saved on this device"
                : "Connected"}
          </span>
        </div>
      </aside>
      <main id="main-content" className="main-panel">
        {selected ? (
          <>
            <header className="conversation-header">
              <IconButton
                label="Back to conversations"
                className="mobile-back"
                onClick={() => {
                  setSelectedId(null);
                  setThreadId(null);
                }}
              >
                <ArrowLeft size={24} />
              </IconButton>
              <ConversationAvatar
                userId={state.user.id}
                conversation={selected}
              />
              <button
                className="conversation-title"
                onClick={() =>
                  setModal({ type: "about", conversation: selected })
                }
              >
                <strong>
                  {selected.name}
                  <ChevronDown size={18} />
                </strong>
                <small>
                  {selected.kind === "dm"
                    ? selected.members.find((p) => p.id !== state.user.id)
                        ?.status || "Direct message"
                    : `${selected.members.length} members`}
                  {selected.muted && " · Muted"}
                </small>
              </button>
              <div className="conversation-header-actions">
                <a
                  className="icon-button"
                  aria-label="Open Google Meet"
                  title="Open Google Meet in a new tab"
                  href="https://meet.google.com/new"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Video size={23} />
                </a>
                <IconButton
                  label="Search this conversation"
                  onClick={() => {
                    setSearchScope(selected.id);
                    setQuery("");
                    setSelectedId(null);
                    setView("search");
                    searchRef.current?.focus();
                  }}
                >
                  <Search size={23} />
                </IconButton>
                <IconButton
                  label="Conversation details"
                  onClick={() =>
                    setModal({ type: "about", conversation: selected })
                  }
                >
                  <Ellipsis size={24} />
                </IconButton>
              </div>
            </header>
            {chat.demo && (
              <div className="demo-notice">
                <span>Demo workspace</span>
                <span>Explore freely. Your changes stay on this device.</span>
                <button onClick={() => setModal({ type: "profile" })}>
                  Your profile
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
            <div className="conversation-tabs">
              <span className="current">Chat</span>
              <button
                onClick={() => {
                  setModal({ type: "about", conversation: selected });
                }}
              >
                Shared <File size={14} />
              </button>
            </div>
            <div
              className="messages-scroll"
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                atBottom.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 90;
              }}
            >
              <div className="conversation-intro">
                <ConversationAvatar
                  userId={state.user.id}
                  conversation={selected}
                />
                <h1>{selected.name}</h1>
                <p>
                  {selected.description ||
                    (selected.kind === "dm"
                      ? `The beginning of your conversation with ${selected.name}.`
                      : "A space to share ideas, ask questions, and move things forward.")}
                </p>
                {selected.kind !== "dm" && (
                  <button
                    className="text-button"
                    onClick={() =>
                      setModal({ type: "invite", conversation: selected })
                    }
                  >
                    <Users size={15} />
                    Add people
                  </button>
                )}
              </div>
              {messages.map((m, i) => (
                <div key={m.id}>
                  {(i === 0 ||
                    new Date(messages[i - 1].createdAt).toDateString() !==
                      new Date(m.createdAt).toDateString()) && (
                    <div className="date-divider">
                      <span>{dateLabel(m.createdAt)}</span>
                    </div>
                  )}
                  {messageRow(m)}
                </div>
              ))}
              {!messages.length && (
                <div className="empty-conversation">
                  <MessageSquare size={28} />
                  <p>Start the conversation</p>
                  <span>Say hello. A good idea often starts there.</span>
                </div>
              )}
            </div>
            {composer()}
          </>
        ) : (
          <div className="home-view">
            <header className="home-header">
              <div>
                <h1>{names[view]}</h1>
                <p>
                  {view === "home"
                    ? "Your conversations, all in one place."
                    : view === "direct"
                      ? "A little closer to your people."
                      : view === "spaces"
                        ? "Big ideas start with a shared space."
                        : view === "starred"
                          ? "Messages you want to come back to."
                          : view === "mentions"
                            ? "Conversations that include you."
                            : view === "sections"
                              ? "Keep your conversations organized."
                              : searchScope
                                ? `Search in ${state.conversations.find((c) => c.id === searchScope)?.name}`
                                : query
                                  ? `Results for “${query}”`
                                  : "Find messages and conversations."}
                </p>
              </div>
              <button
                className={`filter-button ${unreadOnly ? "active" : ""}`}
                onClick={() => setUnreadOnly(!unreadOnly)}
              >
                <span className="filter-dot" />
                Unread{unreadOnly && <Check size={14} />}
              </button>
            </header>
            <div className="mobile-search">
              <Search size={21} />
              <input
                aria-label="Search conversations"
                placeholder={
                  searchScope
                    ? `Search ${state.conversations.find((c) => c.id === searchScope)?.name || "conversation"}`
                    : "Search in chat"
                }
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setView(e.target.value ? "search" : "home");
                  if (!e.target.value) setSearchScope(null);
                }}
              />
            </div>
            {view === "home" && (
              <div className="home-filter-tabs">
                <button className="selected" onClick={() => navigate("home")}>
                  All
                </button>
                <button onClick={() => navigate("direct")}>
                  Direct messages
                </button>
                <button onClick={() => navigate("spaces")}>Spaces</button>
                <button
                  className={pinnedOnly ? "selected" : ""}
                  onClick={() => setPinnedOnly(!pinnedOnly)}
                >
                  <Pin size={12} />
                  Pinned
                </button>
                <IconButton
                  label="Mark all conversations read"
                  onClick={() => {
                    void Promise.all(
                      state.conversations
                        .filter((c) => c.unread)
                        .map((c) =>
                          act({ type: "read", conversationId: c.id }),
                        ),
                    )
                      .then(() => setToast("All conversations marked as read"))
                      .catch(() => {});
                  }}
                >
                  <CheckCheck size={20} />
                </IconButton>
              </div>
            )}
            <div className="conversation-list">
              {view === "starred" ||
              view === "mentions" ||
              (view === "search" && foundMessages.length > 0) ? (
                <>
                  {view === "search" && (
                    <h2 className="list-heading">Messages</h2>
                  )}
                  {foundMessages.map((m) => {
                    const c = state.conversations.find(
                      (c) => c.id === m.conversationId,
                    );
                    return (
                      <button
                        key={m.id}
                        className="search-result"
                        onClick={() => {
                          if (c) openConversation(c);
                          setJumpTarget(m.parentId || m.id);
                          if (m.parentId) setThreadId(m.parentId);
                        }}
                      >
                        <Avatar person={m.author} />
                        <span>
                          <small>
                            {m.author.name} · {c?.name}
                          </small>
                          <strong>{m.text}</strong>
                          <span>
                            {dateLabel(m.createdAt)} · {time(m.createdAt)}
                          </span>
                        </span>
                        <ChevronRight size={18} />
                      </button>
                    );
                  })}
                  {!foundMessages.length && (
                    <div className="empty-state">
                      {view === "starred" ? (
                        <Star size={40} />
                      ) : (
                        <AtSign size={40} />
                      )}
                      <h2>
                        {view === "starred"
                          ? "Save a thought for later"
                          : "You’re all caught up"}
                      </h2>
                      <p>
                        {view === "starred"
                          ? "Star a message in any conversation and find it here."
                          : "Messages that mention your name or @all will appear here."}
                      </p>
                    </div>
                  )}
                </>
              ) : view === "sections" ? (
                <>
                  {sectionNames.length === 0 && (
                    <div className="empty-state">
                      <Folder size={40} />
                      <h2>A place for everything</h2>
                      <p>
                        Open a conversation’s settings to add it to a custom
                        section.
                      </p>
                      <button
                        className="primary-button"
                        onClick={() => navigate("home")}
                      >
                        Browse conversations
                      </button>
                    </div>
                  )}
                  {sectionNames.map((section) => (
                    <div key={section}>
                      <h2 className="list-heading">
                        <Folder size={17} />
                        {section}
                      </h2>
                      {state.conversations
                        .filter((c) => c.section === section)
                        .map((c) => (
                          <button
                            key={c.id}
                            className="conversation-row"
                            onClick={() => openConversation(c)}
                          >
                            <ConversationAvatar
                              userId={state.user.id}
                              conversation={c}
                            />
                            <span className="conversation-row-content">
                              <strong>{c.name}</strong>
                              <span>
                                {c.lastMessage || "Start a conversation"}
                              </span>
                            </span>
                            <ChevronRight size={19} />
                          </button>
                        ))}
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {view === "search" && (
                    <h2 className="list-heading">Conversations</h2>
                  )}
                  {visibleConversations.map((c) => (
                    <div
                      key={c.id}
                      className={`conversation-row-wrap ${c.unread ? "unread-row" : ""}`}
                    >
                      <button
                        className="conversation-row"
                        onClick={() => openConversation(c)}
                      >
                        <ConversationAvatar
                          userId={state.user.id}
                          conversation={c}
                        />
                        <span className="conversation-row-content">
                          <strong>
                            {c.name}
                            {c.pinned && <Pin size={13} />}
                            {c.muted && <BellOff size={13} />}
                          </strong>
                          <span>
                            {c.lastMessage ||
                              c.description ||
                              "Start a conversation"}
                          </span>
                        </span>
                        <span className="conversation-row-meta">
                          <time>{time(c.updatedAt)}</time>
                          {c.unread > 0 && <b>{c.unread}</b>}
                        </span>
                      </button>
                      <IconButton
                        label={`Options for ${c.name}`}
                        className="row-options"
                        onClick={() =>
                          setModal({ type: "about", conversation: c })
                        }
                      >
                        <Ellipsis size={20} />
                      </IconButton>
                    </div>
                  ))}
                  {!visibleConversations.length && (
                    <div className="empty-state">
                      <MessageSquare size={40} />
                      <h2>
                        {unreadOnly
                          ? "You’re all caught up"
                          : query
                            ? "No conversations found"
                            : "Make the first connection"}
                      </h2>
                      <p>
                        {unreadOnly
                          ? "No unread conversations. A nice moment to take a breath."
                          : query
                            ? "Try a different name or keyword."
                            : "Start a conversation or create a space for your team."}
                      </p>
                      {!query && !unreadOnly && (
                        <button
                          className="primary-button"
                          onClick={() =>
                            setModal({
                              type: "new",
                              kind: view === "spaces" ? "space" : "dm",
                            })
                          }
                        >
                          Start a conversation
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>
      {thread && selected && (
        <aside className="thread-panel">
          <header>
            <h2>Thread</h2>
            <IconButton label="Close thread" onClick={() => setThreadId(null)}>
              <X size={22} />
            </IconButton>
          </header>
          <div className="thread-messages">
            {messageRow(thread, true)}
            <div className="thread-divider">
              {replies.length} {replies.length === 1 ? "reply" : "replies"}
            </div>
            {replies.map((m) => messageRow(m, true))}
          </div>
          {composer(true)}
        </aside>
      )}
      <nav className="mobile-tabs" aria-label="Main navigation">
        <button
          className={view === "home" ? "active" : ""}
          onClick={() => navigate("home")}
        >
          <Home size={23} />
          <span>Home</span>
        </button>
        <button
          className={view === "direct" ? "active" : ""}
          onClick={() => navigate("direct")}
        >
          <MessageSquare size={23} />
          <span>Direct messages</span>
        </button>
        <button
          className={view === "sections" || view === "spaces" ? "active" : ""}
          onClick={() => navigate("sections")}
        >
          <Folder size={23} />
          <span>Sections</span>
        </button>
        <button onClick={() => setModal({ type: "more" })}>
          <Ellipsis size={25} />
          <span>More</span>
        </button>
      </nav>
      <button
        className="mobile-new-chat"
        aria-label="New chat"
        onClick={() => setModal({ type: "new", kind: "dm" })}
      >
        <Pencil size={23} />
      </button>
      {toastUI}

      {modal && (
        <Dialog
          title={
            modal.type === "attachment"
              ? "Image preview"
              : modal.type === "new"
                ? "Start a conversation"
                : modal.type === "settings"
                  ? "Settings"
                  : modal.type === "profile"
                    ? "Your profile"
                    : modal.type === "install"
                      ? "Make yourself at home"
                      : modal.type === "more"
                        ? "More in Chat"
                        : modal.type === "voice"
                          ? "Record a voice note"
                          : modal.type === "about"
                            ? modal.conversation.name
                            : modal.type === "conversation"
                              ? "Conversation settings"
                              : modal.type === "invite"
                                ? "Add people"
                                : modal.type === "leave"
                                  ? "Leave this conversation?"
                                  : modal.type === "edit"
                                    ? "Edit message"
                                    : modal.type === "delete"
                                      ? "Delete this message?"
                                      : modal.type === "emoji"
                                        ? "Add a reaction"
                                        : "Message actions"
          }
          onClose={closeModal}
          wide={modal.type === "attachment"}
        >
          {modal.type === "attachment" && (
            <div className="attachment-preview">
              <img src={modal.attachment.url} alt={modal.attachment.name} />
              <div>
                <span>{modal.attachment.name}</span>
                <a
                  className="text-button"
                  href={modal.attachment.url}
                  download={modal.attachment.name}
                >
                  <ArrowDownToLine size={18} />
                  Download original
                </a>
              </div>
            </div>
          )}
          {modal.type === "voice" && (
            <VoiceRecorder
              onRecorded={(attachment) => {
                if (attachments.length >= 3) {
                  setToast("Attach up to 3 files per message.");
                  return;
                }
                setAttachments((files) => [...files, attachment]);
                setModal(null);
                composerRef.current?.focus();
              }}
              onClose={closeModal}
            />
          )}
          {modal.type === "new" && (
            <form onSubmit={submitNew}>
              <div className="kind-tabs">
                {(["dm", "group", "space"] as const).map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    className={modal.kind === kind ? "selected" : ""}
                    onClick={() => setModal({ type: "new", kind })}
                  >
                    {kind === "dm"
                      ? "Direct message"
                      : kind === "group"
                        ? "Group"
                        : "Space"}
                  </button>
                ))}
              </div>
              <label>
                {modal.kind === "dm"
                  ? "Conversation name"
                  : modal.kind === "space"
                    ? "Space name"
                    : "Group name"}
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder={
                    modal.kind === "space"
                      ? "e.g. Design team"
                      : "e.g. Maya Chen"
                  }
                  autoComplete="off"
                />
              </label>
              <label>
                {modal.kind === "dm" ? "Their email" : "Add people by email"}
                <input
                  name="emails"
                  type={modal.kind === "dm" ? "email" : "text"}
                  required={modal.kind !== "space"}
                  placeholder={
                    modal.kind === "dm"
                      ? "name@example.com"
                      : "maya@example.com, alex@example.com"
                  }
                />
                <small>
                  {modal.kind === "dm"
                    ? "Start a private conversation with one person."
                    : "Separate email addresses with commas."}
                </small>
              </label>
              {modal.kind === "space" && (
                <label>
                  Description <span className="optional">optional</span>
                  <textarea
                    name="description"
                    rows={3}
                    maxLength={500}
                    placeholder="What is this space for?"
                  />
                </label>
              )}
              <div className="dialog-footer">
                <button
                  type="button"
                  className="text-button"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={busy}>
                  {busy
                    ? "Creating…"
                    : modal.kind === "space"
                      ? "Create space"
                      : "Start chat"}
                </button>
              </div>
            </form>
          )}
          {modal.type === "profile" && (
            <>
              <div className="profile-summary">
                <Avatar person={state.user} size="large" />
                <strong>{state.user.name}</strong>
                <span>{state.user.email}</span>
                {chat.demo && (
                  <span className="demo-badge">
                    DEMO PROFILE · NOT SIGNED IN
                  </span>
                )}
              </div>
              <form onSubmit={submitProfile}>
                <label>
                  Display name
                  <input
                    name="name"
                    defaultValue={state.user.name}
                    maxLength={80}
                    required
                  />
                </label>
                <label>
                  Status
                  <input
                    name="status"
                    defaultValue={state.user.status || ""}
                    placeholder="e.g. Focusing on something good 🌱"
                    maxLength={80}
                  />
                </label>
                <div className="status-presets">
                  {["Active", "Away", "Do not disturb"].map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => {
                        run(
                          { type: "profile", status },
                          `Status set to ${status}`,
                        );
                        setModal(null);
                      }}
                    >
                      <span
                        className={`status-dot ${status === "Do not disturb" ? "dnd" : status === "Away" ? "away" : ""}`}
                      />
                      {status}
                    </button>
                  ))}
                </div>
                <div className="dialog-footer">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      void chat.signOut();
                      setModal(null);
                    }}
                  >
                    {chat.demo ? "Leave demo" : "Sign out"}
                    <LogOut size={16} />
                  </button>
                  <button className="primary-button" disabled={busy}>
                    Save
                  </button>
                </div>
              </form>
              {chat.demo && (
                <p className="dialog-note">
                  Demo conversations are private to this browser. Sign in with
                  Google to chat with your friends. Your conversations are
                  private to this app.
                </p>
              )}
            </>
          )}
          {modal.type === "settings" && (
            <div className="settings-content">
              <div className="setting-row">
                <span>
                  <Palette size={21} />
                  <span>
                    <strong>Appearance</strong>
                    <small>Make this space yours.</small>
                  </span>
                </span>
                <select
                  aria-label="Appearance"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div className="setting-row">
                <span>
                  <Smartphone size={21} />
                  <span>
                    <strong>Home Screen app</strong>
                    <small>One tap to your conversations.</small>
                  </span>
                </span>
                <button
                  className="text-button"
                  onClick={() => setModal({ type: "install" })}
                >
                  Install
                </button>
              </div>
              <div className="setting-row">
                <span>
                  <Info size={21} />
                  <span>
                    <strong>Chat</strong>
                    <small>
                      {chat.demo
                        ? "Demo · saved on this device"
                        : "Private team messaging"}{" "}
                      · v1.0
                    </small>
                  </span>
                </span>
              </div>
              <p className="dialog-note">
                Video and voice calls, external Google Chat messages, and
                background push notifications are not available in this version.
              </p>
            </div>
          )}
          {modal.type === "install" && (
            <InstallHelp
              canInstall={Boolean(installPrompt)}
              onInstall={async () => {
                if (!installPrompt) return;
                try {
                  await installPrompt.prompt();
                } catch {
                  setToast(
                    "Installation did not complete. You can use your browser menu to try again.",
                  );
                } finally {
                  setInstallPrompt(null);
                }
              }}
            />
          )}
          {modal.type === "more" && (
            <div className="menu-list">
              <button
                onClick={() => {
                  navigate("spaces");
                  setModal(null);
                }}
              >
                <Hash size={21} />
                Spaces
                <ChevronRight size={18} />
              </button>
              <button
                onClick={() => {
                  navigate("mentions");
                  setModal(null);
                }}
              >
                <AtSign size={21} />
                Mentions
                <ChevronRight size={18} />
              </button>
              <button
                onClick={() => {
                  navigate("starred");
                  setModal(null);
                }}
              >
                <Star size={21} />
                Starred
                <ChevronRight size={18} />
              </button>
              <button onClick={() => setModal({ type: "profile" })}>
                <Avatar person={state.user} size="tiny" />
                Your profile
                <ChevronRight size={18} />
              </button>
              <button onClick={() => setModal({ type: "settings" })}>
                <Settings size={21} />
                Settings
                <ChevronRight size={18} />
              </button>
              <button onClick={() => setModal({ type: "install" })}>
                <Smartphone size={21} />
                Add to Home Screen
                <ChevronRight size={18} />
              </button>
            </div>
          )}
          {modal.type === "about" && (
            <>
              <div className="about-summary">
                <ConversationAvatar
                  userId={state.user.id}
                  conversation={modal.conversation}
                />
                <p>
                  {modal.conversation.description ||
                    "A place to keep the conversation going."}
                </p>
              </div>
              <div className="menu-list">
                <button
                  onClick={() =>
                    setModal({
                      type: "conversation",
                      conversation: modal.conversation,
                    })
                  }
                >
                  <Pencil size={20} />
                  Edit details and section
                  <ChevronRight size={18} />
                </button>
                <button
                  onClick={() => {
                    run(
                      {
                        type: "conversation",
                        conversationId: modal.conversation.id,
                        pinned: !modal.conversation.pinned,
                      },
                      modal.conversation.pinned
                        ? "Conversation unpinned"
                        : "Conversation pinned",
                    );
                    setModal(null);
                  }}
                >
                  <Pin size={20} />
                  {modal.conversation.pinned
                    ? "Unpin conversation"
                    : "Pin conversation"}
                </button>
                <button
                  onClick={() => {
                    run(
                      {
                        type: "conversation",
                        conversationId: modal.conversation.id,
                        muted: !modal.conversation.muted,
                      },
                      modal.conversation.muted
                        ? "Conversation unmuted"
                        : "Conversation muted",
                    );
                    setModal(null);
                  }}
                >
                  {modal.conversation.muted ? (
                    <Bell size={20} />
                  ) : (
                    <BellOff size={20} />
                  )}
                  {modal.conversation.muted
                    ? "Unmute conversation"
                    : "Mute conversation"}
                </button>
                <button
                  onClick={() => {
                    run(
                      {
                        type: "read",
                        conversationId: modal.conversation.id,
                        unread: true,
                      },
                      "Marked as unread",
                    );
                    setModal(null);
                    setSelectedId(null);
                  }}
                >
                  <MessageSquare size={20} />
                  Mark as unread
                </button>
                {modal.conversation.kind !== "dm" && (
                  <>
                    <button
                      onClick={() =>
                        setModal({
                          type: "invite",
                          conversation: modal.conversation,
                        })
                      }
                    >
                      <Users size={20} />
                      Add people
                      <ChevronRight size={18} />
                    </button>
                  </>
                )}
                <button
                  onClick={() => void shareInvitation(modal.conversation)}
                >
                  <ArrowUpRight size={20} />
                  Share invitation
                  <ChevronRight size={18} />
                </button>
                <button onClick={() => void copyInvitation(modal.conversation)}>
                  <Link size={20} />
                  Copy invitation link
                  <Copy size={17} />
                </button>
                <button
                  className="danger"
                  onClick={() =>
                    setModal({
                      type: "leave",
                      conversation: modal.conversation,
                    })
                  }
                >
                  <LogOut size={20} />
                  Leave conversation
                </button>
              </div>
              <h3 className="small-heading">
                Members · {modal.conversation.members.length}
              </h3>
              <div className="member-list">
                {modal.conversation.members.map((p) => (
                  <div key={p.id}>
                    <Avatar person={p} size="small" />
                    <span>
                      <strong>
                        {p.name}
                        {p.id === state.user.id ? " (you)" : ""}
                      </strong>
                      <small>{p.email}</small>
                    </span>
                  </div>
                ))}
              </div>
              <h3 className="small-heading">Shared files</h3>
              <div className="shared-files">
                {state.messages
                  .filter(
                    (m) =>
                      m.conversationId === modal.conversation.id && !m.deleted,
                  )
                  .flatMap((m) => m.attachments)
                  .map((f, i) => (
                    <a key={i} href={f.url} download={f.name}>
                      <File size={20} />
                      <span>{f.name}</span>
                      <ArrowDownToLine size={17} />
                    </a>
                  ))}
                {!state.messages.some(
                  (m) =>
                    m.conversationId === modal.conversation.id &&
                    !m.deleted &&
                    m.attachments.length,
                ) && (
                  <p className="dialog-note">
                    Files shared in this conversation will appear here.
                  </p>
                )}
              </div>
            </>
          )}
          {modal.type === "conversation" && (
            <form onSubmit={submitConversation}>
              <label>
                Name
                <input
                  name="name"
                  defaultValue={modal.conversation.name}
                  required
                  maxLength={80}
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  defaultValue={modal.conversation.description || ""}
                  rows={3}
                  maxLength={500}
                />
              </label>
              <label>
                Section
                <input
                  name="section"
                  defaultValue={modal.conversation.section || ""}
                  list="section-names"
                  placeholder="e.g. Projects"
                  maxLength={40}
                />
                <datalist id="section-names">
                  {sectionNames.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <small>
                  Enter a new section name, or leave blank to use the default
                  list.
                </small>
              </label>
              <div className="dialog-footer">
                <button
                  type="button"
                  className="text-button"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={busy}>
                  Save
                </button>
              </div>
            </form>
          )}
          {modal.type === "invite" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                setBusy(true);
                try {
                  await act(
                    {
                      type: "invite",
                      conversationId: modal.conversation.id,
                      emails: String(data.get("emails") || "")
                        .split(/[,\s]+/)
                        .filter(Boolean),
                    },
                    "People added",
                  );
                  setModal(null);
                } catch {
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="dialog-note">
                Invite people to {modal.conversation.name} by their email
                address. They can sign in with Google to participate.
              </p>
              <label>
                Email addresses
                <input
                  name="emails"
                  placeholder="maya@example.com, alex@example.com"
                  required
                />
                <small>Separate email addresses with commas.</small>
              </label>
              <div className="dialog-footer">
                <button
                  type="button"
                  className="text-button"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={busy}>
                  Add people
                </button>
              </div>
            </form>
          )}
          {modal.type === "leave" && (
            <>
              <p className="dialog-note">
                You’ll leave <strong>{modal.conversation.name}</strong> and it
                will be removed from your conversation list. Other members can
                still see the messages.
              </p>
              <div className="dialog-footer">
                <button className="text-button" onClick={closeModal}>
                  Cancel
                </button>
                <button
                  className="danger-button"
                  onClick={async () => {
                    try {
                      await act(
                        {
                          type: "leave",
                          conversationId: modal.conversation.id,
                        },
                        "You left the conversation",
                      );
                      setModal(null);
                      setSelectedId(null);
                      setThreadId(null);
                    } catch {}
                  }}
                >
                  Leave conversation
                </button>
              </div>
            </>
          )}
          {modal.type === "message" && (
            <div className="menu-list">
              <button
                onClick={() =>
                  setModal({ type: "emoji", message: modal.message })
                }
              >
                <Smile size={20} />
                Add reaction
                <ChevronRight size={18} />
              </button>
              <button
                onClick={() => {
                  setThreadId(modal.message.parentId || modal.message.id);
                  setModal(null);
                }}
              >
                <MessageSquare size={20} />
                Reply in thread
              </button>
              <button
                onClick={() => {
                  run({ type: "star", messageId: modal.message.id });
                  setModal(null);
                }}
              >
                <Star size={20} />
                {modal.message.starred ? "Unstar message" : "Star message"}
              </button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(modal.message.text);
                    setToast("Message copied");
                    setModal(null);
                  } catch {
                    setToast(
                      "Copy is unavailable in this browser. Select the message text to copy it.",
                    );
                  }
                }}
              >
                <Copy size={20} />
                Copy text
              </button>
              {modal.message.author.id === state.user.id && (
                <>
                  <button
                    onClick={() =>
                      setModal({ type: "edit", message: modal.message })
                    }
                  >
                    <Pencil size={20} />
                    Edit message
                  </button>
                  <button
                    className="danger"
                    onClick={() =>
                      setModal({ type: "delete", message: modal.message })
                    }
                  >
                    <Trash2 size={20} />
                    Delete message
                  </button>
                </>
              )}
            </div>
          )}
          {modal.type === "emoji" && (
            <div className="emoji-grid">
              {EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  aria-label={`React ${emoji}`}
                  onClick={() => {
                    run({ type: "react", messageId: modal.message.id, emoji });
                    setModal(null);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          {modal.type === "edit" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const text = String(
                  new FormData(e.currentTarget).get("text") || "",
                ).trim();
                if (!text) return;
                setBusy(true);
                try {
                  await act(
                    { type: "edit", messageId: modal.message.id, text },
                    "Message updated",
                  );
                  setModal(null);
                } catch {
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Message
                <textarea
                  name="text"
                  defaultValue={modal.message.text}
                  required
                  rows={5}
                  maxLength={6000}
                />
              </label>
              <div className="dialog-footer">
                <button
                  className="text-button"
                  type="button"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={busy}>
                  Save
                </button>
              </div>
            </form>
          )}
          {modal.type === "delete" && (
            <>
              <p className="dialog-note">
                This removes the message and its attachments for everyone in
                this conversation. Replies remain in the thread.
              </p>
              <blockquote className="delete-preview">
                {modal.message.text || "Attached files"}
              </blockquote>
              <div className="dialog-footer">
                <button className="text-button" onClick={closeModal}>
                  Cancel
                </button>
                <button
                  className="danger-button"
                  onClick={async () => {
                    try {
                      await act(
                        { type: "delete", messageId: modal.message.id },
                        "Message deleted",
                      );
                      setModal(null);
                    } catch {}
                  }}
                >
                  Delete message
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}

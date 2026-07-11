// Module-level singleton store for LlmChatPanel's conversations, keyed by
// note (see LlmChatPanel's noteKey — "current-note" until the app wires a
// real per-note id). Chat turns used to live as local component state
// (messages/busy/error) and were awaited inline inside the panel, so closing
// the panel unmounted it and dropped both the in-flight streaming reply and
// the whole history. Sends now run through the background AI task queue
// (../lib/aiTaskQueue.ts), which keeps running after the panel unmounts — so
// the streamed reply has to keep landing *somewhere* that outlives the
// panel's lifecycle too. This module is that somewhere.
//
// Plain module-level state (a Map + a subscriber Set), not a class, mirrors
// aiTaskQueue.ts: there's exactly one store for the whole app, so a
// singleton is simpler than an instance callers would have to thread
// through. Every mutator replaces a session immutably and notifies
// subscribers, the same "snapshot + notify" shape aiTaskQueue.ts uses for
// its task list.

import { useEffect, useState } from "preact/hooks";

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  /** Set on an assistant message that failed, so it can render as an error. */
  error?: boolean;
}

export interface ChatSession {
  messages: readonly DisplayMessage[];
  busy: boolean;
  error: string | null;
}

const EMPTY_SESSION: ChatSession = { messages: [], busy: false, error: null };

const sessions = new Map<string, ChatSession>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.warn("[chatSessions] listener failed", err);
    }
  }
}

function setSession(key: string, session: ChatSession): void {
  sessions.set(key, session);
  notify();
}

/** Returns an immutable snapshot for `key`, or an empty session if none exists yet. */
export function getChatSession(key: string): ChatSession {
  return sessions.get(key) ?? EMPTY_SESSION;
}

export function subscribeChatSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// preact/hooks has no useSyncExternalStore, so this hand-rolls the same
// subscribe-and-resync pattern as useAiTaskQueue.ts: read the current
// snapshot eagerly for the initial render, then subscribe and re-read on
// every notification (and once more on mount, in case the store changed in
// the gap between render and the subscription taking effect).
export function useChatSession(key: string): ChatSession {
  const [session, setSessionState] = useState<ChatSession>(() => getChatSession(key));

  useEffect(() => {
    setSessionState(getChatSession(key));
    return subscribeChatSessions(() => setSessionState(getChatSession(key)));
  }, [key]);

  return session;
}

/**
 * Appends a user message and an empty assistant placeholder, and marks the
 * session busy (mirrors the just-submitted turn showing up immediately, with
 * the reply streaming into the placeholder as it arrives). Returns the
 * history *including* the new user message but *excluding* the placeholder,
 * for building the outgoing wire payload.
 */
export function appendUserMessage(key: string, text: string): readonly DisplayMessage[] {
  const current = getChatSession(key);
  const history: DisplayMessage[] = [...current.messages, { role: "user", content: text }];
  setSession(key, { messages: [...history, { role: "assistant", content: "" }], busy: true, error: null });
  return history;
}

/** Replaces the last (streaming placeholder) assistant message's content with the latest full-text snapshot. */
export function updateStreamingAssistant(key: string, full: string): void {
  const current = getChatSession(key);
  if (current.messages.length === 0) return;
  const messages = current.messages.slice();
  messages[messages.length - 1] = { role: "assistant", content: full };
  setSession(key, { ...current, messages });
}

/** Finalizes a successful reply: the last delta already left the placeholder in its final state, so this just clears `busy`. */
export function finalizeChatSuccess(key: string): void {
  const current = getChatSession(key);
  setSession(key, { ...current, busy: false });
}

/** Finalizes a failed reply: turns the placeholder into an inline error bubble and records the session-level error message. */
export function finalizeChatFailure(key: string, message: string): void {
  const current = getChatSession(key);
  if (current.messages.length === 0) {
    setSession(key, { messages: [], busy: false, error: message });
    return;
  }
  const messages = current.messages.slice();
  messages[messages.length - 1] = { role: "assistant", content: message, error: true };
  setSession(key, { messages, busy: false, error: message });
}

/**
 * Finalizes a cancelled (stopped) reply: keeps any partial content already
 * streamed into the placeholder as-is, and only stamps the `cancelledLabel`
 * onto it when nothing had streamed yet (an empty placeholder would
 * otherwise render as a blank bubble). Does not set a session error — a
 * user-initiated stop isn't a failure.
 */
export function finalizeChatCancel(key: string, cancelledLabel: string): void {
  const current = getChatSession(key);
  if (current.messages.length === 0) {
    setSession(key, { ...current, busy: false });
    return;
  }
  const messages = current.messages.slice();
  const last = messages[messages.length - 1];
  if (last.role === "assistant" && !last.content) {
    messages[messages.length - 1] = { ...last, content: cancelledLabel };
  }
  setSession(key, { messages, busy: false, error: null });
}

/** Clears a session's error flag (e.g. before starting a fresh turn) without touching its messages. */
export function clearChatError(key: string): void {
  const current = getChatSession(key);
  if (!current.error) return;
  setSession(key, { ...current, error: null });
}

/** Test-only: clear all state. */
export function __resetChatSessionsForTests(): void {
  sessions.clear();
  listeners.clear();
}

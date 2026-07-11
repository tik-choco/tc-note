import { useEffect, useRef, useState } from "preact/hooks";
import { useAppSettings, useT } from "../hooks/useAppSettings";
import { Icon } from "./Icon";
import { formatMistaiError, MESSAGES_EN, MESSAGES_JA, type ChatMessage } from "@tik-choco/mistai";
import { ConsumerStatusIndicator } from "@tik-choco/mistai/preact";
import type { UseLlmNetResult } from "../hooks/useLlmNet";
import { enqueueAiTask, cancelAiTask } from "../lib/aiTaskQueue";
import { useAiTaskQueue } from "../hooks/useAiTaskQueue";
import {
  useChatSession,
  appendUserMessage,
  updateStreamingAssistant,
  finalizeChatSuccess,
  finalizeChatFailure,
  finalizeChatCancel,
} from "../lib/chatSessions";

const TITLE_MAX_LEN = 40;

function truncateTitle(text: string): string {
  return text.length > TITLE_MAX_LEN ? `${text.slice(0, TITLE_MAX_LEN)}…` : text;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// A side panel to converse with the assistant about the current note. Picks
// its transport from the shared useLlmNet result (api vs the collab-room LLM
// network) and can optionally prepend the current note's text as context.
//
// The conversation itself (messages/busy/error) lives in the module-level
// chatSessions store, keyed by note, rather than local component state:
// sends are enqueued onto the background AI task queue (lib/aiTaskQueue.ts)
// instead of being awaited inline, so a reply keeps streaming into the store
// even while this panel is unmounted (closed, or showing a different note).
// Reopening the panel just re-subscribes to whatever the store already has.
export function LlmChatPanel(props: {
  net: UseLlmNetResult;
  /** Current note title + body, offered as optional context to the model. */
  noteTitle: string;
  noteText: string;
  /** Identifies which note's chat session to show/append to. Defaults to a single shared session until callers wire a real per-note id. */
  noteId?: string;
  onClose: () => void;
}) {
  const { net, noteTitle, noteText, noteId, onClose } = props;
  const noteKey = noteId ?? "current-note";
  const t = useT();
  const { language } = useAppSettings();
  const mistaiMessages = language === "ja" ? MESSAGES_JA : MESSAGES_EN;

  const session = useChatSession(noteKey);
  const { messages, busy, error } = session;

  const [input, setInput] = useState("");
  const [includeContext, setIncludeContext] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const tasks = useAiTaskQueue();
  const pendingTask = tasks.find(
    (task) =>
      task.kind === "chat" &&
      task.noteId === noteKey &&
      (task.status === "queued" || task.status === "running" || task.status === "cancelling"),
  );

  // The transport is unavailable when "network" is selected but we're not in a
  // room, or "api" is selected but no provider is configured.
  const transportBlocked =
    (net.connection === "network" && !net.networkAvailable) || (net.connection === "api" && !net.apiReady);

  const hint =
    net.connection === "network" && !net.networkAvailable
      ? t("llmChat.hint.needRoom")
      : net.connection === "network" && net.providerCount === 0
        ? t("llmChat.hint.searchingProvider")
        : net.connection === "api" && !net.apiReady
          ? t("llmChat.hint.needProvider")
          : null;

  // Keep the transcript pinned to the latest message as it streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSend() {
    const text = input.trim();
    if (!text || busy || transportBlocked) return;

    const history = appendUserMessage(noteKey, text);
    setInput("");

    // Build the wire payload: optional note-context system message, then the
    // running conversation (excluding the empty assistant placeholder).
    const outgoing: ChatMessage[] = [];
    if (includeContext && noteText.trim()) {
      const title = noteTitle.trim();
      const contextBody = title ? `# ${title}\n\n${noteText}` : noteText;
      outgoing.push({ role: "system", content: `${t("llmChat.contextPrefix")}\n\n${contextBody}` });
    }
    for (const m of history) outgoing.push({ role: m.role, content: m.content });

    // Enqueued (not awaited) so the reply keeps streaming into the store —
    // and thus completes — even if this panel unmounts before it's done. The
    // run closure below is the only thing touching the store from here on;
    // this component just renders whatever the store's snapshot is.
    enqueueAiTask<string>({
      kind: "chat",
      title: truncateTitle(text),
      noteId: noteKey,
      run: async ({ signal, setProgress }) => {
        try {
          const full = await net.send(
            outgoing,
            (_delta, fullSoFar) => {
              updateStreamingAssistant(noteKey, fullSoFar);
              setProgress({ chars: fullSoFar.length });
            },
            signal,
          );
          finalizeChatSuccess(noteKey);
          return full;
        } catch (err) {
          if (signal.aborted || isAbortError(err)) {
            finalizeChatCancel(noteKey, t("llmChat.queue.cancelled"));
            throw err;
          }
          // MistaiError codes map through the shared catalog (current
          // language); other errors fall back to their raw message.
          const message = formatMistaiError(err, mistaiMessages, String(err));
          finalizeChatFailure(noteKey, message);
          throw new Error(message);
        }
      },
    });

    inputRef.current?.focus();
  }

  function handleStop() {
    if (pendingTask) cancelAiTask(pendingTask.id);
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Enter sends; Shift+Enter inserts a newline. Ignore while an IME is
    // composing so committing a candidate doesn't fire a send.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <aside class="llm-chat-panel" role="complementary" aria-label={t("llmChat.title")}>
      <div class="llm-chat-header">
        <span class="llm-chat-title">{t("llmChat.title")}</span>
        <div class="llm-chat-header-meta">
          {net.connection === "network" ? (
            <ConsumerStatusIndicator status={net.consumerStatus} messages={mistaiMessages} />
          ) : (
            <span class="llm-chat-badge">{t("llmChat.transport.api")}</span>
          )}
          {net.providerModeActive && (
            <span class="llm-chat-badge llm-chat-badge--serving" title={t("llmChat.providerServingHint")}>
              {mistaiMessages.providerStatus.connected}
            </span>
          )}
          <button type="button" class="icon-btn" onClick={onClose} aria-label={t("llmChat.close")} title={t("llmChat.close")}>
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>

      <div class="llm-chat-messages" ref={scrollRef}>
        {messages.length === 0 && <div class="llm-chat-empty">{t("llmChat.empty")}</div>}
        {messages.map((m, i) => (
          <div key={i} class={`llm-chat-msg llm-chat-msg--${m.role} ${m.error ? "llm-chat-msg--error" : ""}`}>
            {m.content || (busy && i === messages.length - 1 ? t("llmChat.thinking") : "")}
          </div>
        ))}
      </div>

      {hint && <div class="llm-chat-hint">{hint}</div>}
      {error && !messages.some((m) => m.error) && <div class="llm-chat-error">{error}</div>}

      <div class="llm-chat-composer">
        <label class="llm-chat-context-toggle">
          <input
            type="checkbox"
            checked={includeContext}
            onChange={(e) => setIncludeContext((e.target as HTMLInputElement).checked)}
          />
          <span>{t("llmChat.includeContext")}</span>
        </label>
        <div class="llm-chat-input-row">
          <textarea
            ref={inputRef}
            class="llm-chat-input"
            rows={2}
            value={input}
            disabled={transportBlocked}
            placeholder={transportBlocked ? (hint ?? "") : t("llmChat.placeholder")}
            onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
            onKeyDown={handleKeyDown}
          />
          {busy ? (
            <button
              type="button"
              class="llm-chat-stop icon-btn"
              onClick={handleStop}
              disabled={!pendingTask || pendingTask.status === "cancelling"}
              aria-label={t("llmChat.queue.stop")}
              title={t("llmChat.queue.stop")}
            >
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button
              type="button"
              class="llm-chat-send icon-btn"
              onClick={handleSend}
              disabled={transportBlocked || !input.trim()}
              aria-label={t("llmChat.send")}
              title={t("llmChat.send")}
            >
              <Icon name="send" size={18} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

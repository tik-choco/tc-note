// Exercises the module-level chat session store (lib/chatSessions.ts):
// per-key session isolation, the append/stream/finalize mutators the panel
// and the AI task queue's run closure drive, and subscriber notification.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getChatSession,
  subscribeChatSessions,
  appendUserMessage,
  updateStreamingAssistant,
  finalizeChatSuccess,
  finalizeChatFailure,
  finalizeChatCancel,
  clearChatError,
  __resetChatSessionsForTests,
} from "../chatSessions";

beforeEach(() => {
  __resetChatSessionsForTests();
});

describe("getChatSession", () => {
  it("returns an empty session for a key that has never been touched", () => {
    expect(getChatSession("note-a")).toEqual({ messages: [], busy: false, error: null });
  });
});

describe("appendUserMessage", () => {
  it("appends the user message plus an empty assistant placeholder, and marks the session busy", () => {
    const history = appendUserMessage("note-a", "hello");
    expect(history).toEqual([{ role: "user", content: "hello" }]);

    const session = getChatSession("note-a");
    expect(session.busy).toBe(true);
    expect(session.error).toBeNull();
    expect(session.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "" },
    ]);
  });

  it("keeps sessions isolated per key", () => {
    appendUserMessage("note-a", "hi a");
    appendUserMessage("note-b", "hi b");
    expect(getChatSession("note-a").messages).toHaveLength(2);
    expect(getChatSession("note-b").messages).toHaveLength(2);
    expect(getChatSession("note-a").messages[0].content).toBe("hi a");
    expect(getChatSession("note-b").messages[0].content).toBe("hi b");
  });

  it("builds on prior history across multiple turns", () => {
    appendUserMessage("note-a", "first");
    updateStreamingAssistant("note-a", "first reply");
    finalizeChatSuccess("note-a");
    const history = appendUserMessage("note-a", "second");
    expect(history.map((m) => m.content)).toEqual(["first", "first reply", "second"]);
  });
});

describe("updateStreamingAssistant", () => {
  it("replaces the last (placeholder) message's content as deltas stream in", () => {
    appendUserMessage("note-a", "hello");
    updateStreamingAssistant("note-a", "Hel");
    updateStreamingAssistant("note-a", "Hello there");

    const session = getChatSession("note-a");
    expect(session.messages.at(-1)).toEqual({ role: "assistant", content: "Hello there" });
    // The user message is untouched.
    expect(session.messages[0]).toEqual({ role: "user", content: "hello" });
  });

  it("is a no-op when there is no session yet", () => {
    updateStreamingAssistant("note-a", "nothing to update");
    expect(getChatSession("note-a").messages).toEqual([]);
  });
});

describe("finalizeChatSuccess", () => {
  it("clears busy and leaves the streamed content in place", () => {
    appendUserMessage("note-a", "hello");
    updateStreamingAssistant("note-a", "final reply");
    finalizeChatSuccess("note-a");

    const session = getChatSession("note-a");
    expect(session.busy).toBe(false);
    expect(session.messages.at(-1)).toEqual({ role: "assistant", content: "final reply" });
  });
});

describe("finalizeChatFailure", () => {
  it("turns the placeholder into an inline error and sets the session error", () => {
    appendUserMessage("note-a", "hello");
    finalizeChatFailure("note-a", "boom");

    const session = getChatSession("note-a");
    expect(session.busy).toBe(false);
    expect(session.error).toBe("boom");
    expect(session.messages.at(-1)).toEqual({ role: "assistant", content: "boom", error: true });
  });
});

describe("finalizeChatCancel", () => {
  it("stamps the cancelled label onto an empty placeholder", () => {
    appendUserMessage("note-a", "hello");
    finalizeChatCancel("note-a", "(stopped)");

    const session = getChatSession("note-a");
    expect(session.busy).toBe(false);
    expect(session.error).toBeNull();
    expect(session.messages.at(-1)).toEqual({ role: "assistant", content: "(stopped)" });
  });

  it("keeps partial streamed content instead of overwriting it with the cancelled label", () => {
    appendUserMessage("note-a", "hello");
    updateStreamingAssistant("note-a", "partial rep");
    finalizeChatCancel("note-a", "(stopped)");

    const session = getChatSession("note-a");
    expect(session.busy).toBe(false);
    expect(session.messages.at(-1)).toEqual({ role: "assistant", content: "partial rep" });
  });
});

describe("clearChatError", () => {
  it("clears a set error without touching messages", () => {
    appendUserMessage("note-a", "hello");
    finalizeChatFailure("note-a", "boom");
    clearChatError("note-a");

    const session = getChatSession("note-a");
    expect(session.error).toBeNull();
    expect(session.messages.at(-1)).toEqual({ role: "assistant", content: "boom", error: true });
  });

  it("is a no-op when there is no error", () => {
    const listener = vi.fn();
    subscribeChatSessions(listener);
    clearChatError("note-a");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("subscribeChatSessions", () => {
  it("notifies subscribers on every mutation and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeChatSessions(listener);

    appendUserMessage("note-a", "hi");
    expect(listener).toHaveBeenCalledTimes(1);

    updateStreamingAssistant("note-a", "hi there");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    finalizeChatSuccess("note-a");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

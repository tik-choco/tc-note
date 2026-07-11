import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isOnboardingDone,
  markOnboardingDone,
  shouldShowOnboarding,
  subscribeOnboardingRequests,
  requestOnboarding,
} from "../onboarding";

const DONE_KEY = "tc-note:onboarding-done";
const NOTE_INDEX_KEY = "tc-note:index";

// This project's vitest setup runs in plain Node without jsdom, and Node's
// experimental global `localStorage` isn't a full Storage implementation
// (no clear()/removeItem()) — so stand in a minimal in-memory version for
// onboarding.ts's raw localStorage.getItem/setItem calls to hit. Mirrors the
// stub used in llmSettings.test.ts.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
});

// Minimal realistic slice of mistlib.ts's NoteMeta shape — only the fields
// that matter for this test are filled in with plausible values.
function makeStoredNote() {
  return {
    id: "n1",
    title: "My note",
    cid: "bafy-test",
    updatedAt: Date.now(),
    favorite: false,
    preview: "hello world",
    folderId: null,
  };
}

describe("shouldShowOnboarding", () => {
  it("is true on a fresh install (no keys at all)", () => {
    expect(shouldShowOnboarding()).toBe(true);
  });

  it("is false once the done flag is set", () => {
    markOnboardingDone();
    expect(shouldShowOnboarding()).toBe(false);
  });

  it("is false when tc-note:index already has notes, and persists the migration guard", () => {
    localStorage.setItem(NOTE_INDEX_KEY, JSON.stringify([makeStoredNote()]));
    expect(shouldShowOnboarding()).toBe(false);
    // Migration guard should have silently written the done flag so we don't
    // re-check on every subsequent launch.
    expect(isOnboardingDone()).toBe(true);
    expect(localStorage.getItem(DONE_KEY)).toBe("1");
  });

  it("treats corrupted tc-note:index JSON as no notes, without throwing", () => {
    localStorage.setItem(NOTE_INDEX_KEY, "{not valid json");
    expect(() => shouldShowOnboarding()).not.toThrow();
    expect(shouldShowOnboarding()).toBe(true);
  });

  it("treats an empty tc-note:index array as no notes", () => {
    localStorage.setItem(NOTE_INDEX_KEY, JSON.stringify([]));
    expect(shouldShowOnboarding()).toBe(true);
  });
});

describe("isOnboardingDone / markOnboardingDone", () => {
  it("is false before markOnboardingDone is called", () => {
    expect(isOnboardingDone()).toBe(false);
  });

  it("becomes true after markOnboardingDone", () => {
    markOnboardingDone();
    expect(isOnboardingDone()).toBe(true);
  });
});

describe("onboarding re-open pub/sub", () => {
  it("invokes a subscribed listener on requestOnboarding", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOnboardingRequests(listener);
    requestOnboarding();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stops invoking the listener after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOnboardingRequests(listener);
    unsubscribe();
    requestOnboarding();
    expect(listener).not.toHaveBeenCalled();
  });

  it("a throwing listener does not prevent other listeners from running", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const ok = vi.fn();
    const unsubscribeThrowing = subscribeOnboardingRequests(throwing);
    const unsubscribeOk = subscribeOnboardingRequests(ok);

    expect(() => requestOnboarding()).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();

    unsubscribeThrowing();
    unsubscribeOk();
    warnSpy.mockRestore();
  });
});

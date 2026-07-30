import { describe, it, expect } from "vitest";
import { pwaPromptReducer, type PwaPromptState } from "../pwa";

// pwaPromptReducer is the only DOM-free logic in src/lib/pwa.ts (the rest —
// usePwaUpdate — dynamically imports `virtual:pwa-register` and touches
// `navigator`/`window` inside effects, so it needs an actual browser to
// exercise). This file only imports the reducer + its state type, never
// `usePwaUpdate`, so importing it never triggers the service-worker wiring.

const initial: PwaPromptState = { needRefresh: false, offlineReady: false };

describe("pwaPromptReducer", () => {
  it("starts with nothing pending", () => {
    expect(initial).toEqual({ needRefresh: false, offlineReady: false });
  });

  it("need-refresh sets needRefresh and clears offlineReady", () => {
    const state = pwaPromptReducer(initial, { type: "need-refresh" });
    expect(state).toEqual({ needRefresh: true, offlineReady: false });
  });

  it("offline-ready sets offlineReady from the initial state", () => {
    const state = pwaPromptReducer(initial, { type: "offline-ready" });
    expect(state).toEqual({ needRefresh: false, offlineReady: true });
  });

  it("offline-ready does not clobber a pending need-refresh", () => {
    const needsRefresh = pwaPromptReducer(initial, { type: "need-refresh" });
    const state = pwaPromptReducer(needsRefresh, { type: "offline-ready" });
    expect(state).toEqual({ needRefresh: true, offlineReady: false });
  });

  it("dismiss clears a pending need-refresh", () => {
    const needsRefresh = pwaPromptReducer(initial, { type: "need-refresh" });
    expect(pwaPromptReducer(needsRefresh, { type: "dismiss" })).toEqual(initial);
  });

  it("dismiss clears a pending offline-ready", () => {
    const offlineReady = pwaPromptReducer(initial, { type: "offline-ready" });
    expect(pwaPromptReducer(offlineReady, { type: "dismiss" })).toEqual(initial);
  });

  it("dismiss is a no-op from the initial state", () => {
    expect(pwaPromptReducer(initial, { type: "dismiss" })).toEqual(initial);
  });
});

import { describe, expect, it } from "vitest";
import { pickFocusAfterUnmount } from "../util";

// Regression coverage for the focus-restoration bug in LlmSettingsPanel: when
// the provider edit form (or a deleted provider's own row) unmounts, focus
// used to fall through to <body> because nothing re-focused an existing
// element. pickFocusAfterUnmount is the pure decision extracted from that
// fix — the DOM .focus() call itself isn't exercised here since this
// project's vitest setup has no DOM environment (no jsdom in
// devDependencies, no `environment` override in vite.config.ts).
describe("pickFocusAfterUnmount", () => {
  it("prefers the element keyed to id when present", () => {
    const byId = { a: "button-a", b: "button-b" };
    expect(pickFocusAfterUnmount("a", byId, "fallback")).toBe("button-a");
  });

  it("falls back when id has no entry (e.g. a brand-new item)", () => {
    const byId = { a: "button-a" };
    expect(pickFocusAfterUnmount("new", byId, "fallback")).toBe("fallback");
  });

  it("falls back when the keyed element already unmounted (ref callback fired with null)", () => {
    const byId = { a: null };
    expect(pickFocusAfterUnmount("a", byId, "fallback")).toBe("fallback");
  });

  it("falls back when id is null", () => {
    const byId = { a: "button-a" };
    expect(pickFocusAfterUnmount(null, byId, "fallback")).toBe("fallback");
  });

  it("returns null when there's no keyed element and no fallback", () => {
    expect(pickFocusAfterUnmount(null, {}, null)).toBeNull();
  });
});

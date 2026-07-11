import { describe, expect, it, afterEach } from "vitest";
import { inviteUrl } from "../CollabButton";

// No jsdom in this project's test setup — inviteUrl only reads
// `window.location.href` (via withNoteParam), so a minimal stub is enough.
// The component's popover behavior (clicking the trigger only opens the
// popover; sharing starts via its explicit "start sharing" button) has no
// DOM harness to render under, so it stays untested here.
function stubLocation(href: string) {
  (globalThis as { window?: unknown }).window = { location: { href } };
}

describe("inviteUrl", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("includes both room and note so a joiner can open the exact shared note", () => {
    stubLocation("https://example.test/");
    expect(inviteUrl("room-1", "note-1")).toBe("https://example.test/?note=note-1&room=room-1");
  });

  it("omits note when the sharer's note has no durable id yet", () => {
    stubLocation("https://example.test/");
    expect(inviteUrl("room-1", null)).toBe("https://example.test/?room=room-1");
  });

  it("preserves an unrelated existing query param", () => {
    stubLocation("https://example.test/?theme=dark");
    expect(inviteUrl("room-1", "note-1")).toBe("https://example.test/?theme=dark&note=note-1&room=room-1");
  });
});

import { describe, expect, it, afterEach } from "vitest";
import { withNoteParam } from "../useNoteUrlSync";

// No jsdom in this project's test setup — withNoteParam only reads
// `window.location.href`, so a minimal stub is enough.
function stubLocation(href: string) {
  (globalThis as { window?: unknown }).window = { location: { href } };
}

describe("withNoteParam", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("sets the note param while preserving other params", () => {
    stubLocation("https://example.test/?room=abc");
    expect(withNoteParam("note-1")).toBe("https://example.test/?room=abc&note=note-1");
  });

  it("overwrites an existing note param", () => {
    stubLocation("https://example.test/?note=old&room=abc");
    expect(withNoteParam("new")).toBe("https://example.test/?note=new&room=abc");
  });

  it("removes the note param when passed null", () => {
    stubLocation("https://example.test/?note=old&room=abc");
    expect(withNoteParam(null)).toBe("https://example.test/?room=abc");
  });
});

import { describe, it, expect } from "vitest";
import { searchNotes, type HighlightSegment } from "../globalSearch";
import type { NoteMeta } from "../mistlib";

// Minimal NoteMeta factory — only the fields searchNotes reads matter here.
function note(id: string, title: string, updatedAt = 0, folderId: string | null = null): NoteMeta {
  return { id, title, cid: null, updatedAt, favorite: false, preview: "", folderId };
}

// Flattens highlight segments back to plain text for content assertions.
function plain(segments: HighlightSegment[]): string {
  return segments.map((s) => s.text).join("");
}

// The substrings that were flagged as matches (what the UI wraps in <mark>).
function marks(segments: HighlightSegment[]): string[] {
  return segments.filter((s) => s.match).map((s) => s.text);
}

describe("searchNotes", () => {
  it("returns recent notes untouched when the query is empty", () => {
    const notes = [note("a", "Alpha"), note("b", "Beta"), note("c", "Gamma")];
    const results = searchNotes(notes, {}, "");
    expect(results.map((r) => r.note.id)).toEqual(["a", "b", "c"]);
    expect(results.every((r) => r.score === 0)).toBe(true);
    expect(results.every((r) => marks(r.titleSegments).length === 0)).toBe(true);
  });

  it("honors the result limit", () => {
    const notes = Array.from({ length: 10 }, (_, i) => note(`n${i}`, `Note ${i}`));
    expect(searchNotes(notes, {}, "", 3)).toHaveLength(3);
  });

  it("matches note bodies, not just titles", () => {
    const notes = [note("a", "Shopping"), note("b", "Journal")];
    const bodies = { a: "milk and eggs", b: "today I learned about databases" };
    const results = searchNotes(notes, bodies, "database");
    expect(results.map((r) => r.note.id)).toEqual(["b"]);
  });

  it("is case-insensitive", () => {
    const notes = [note("a", "Meeting Notes")];
    const results = searchNotes(notes, { a: "" }, "MEETING");
    expect(results).toHaveLength(1);
    expect(marks(results[0].titleSegments)).toEqual(["Meeting"]);
  });

  it("ranks title matches above body-only matches", () => {
    const notes = [note("body", "Unrelated"), note("title", "Roadmap")];
    const bodies = { body: "see the roadmap section", title: "" };
    const results = searchNotes(notes, bodies, "roadmap");
    expect(results.map((r) => r.note.id)).toEqual(["title", "body"]);
  });

  it("ranks a title prefix match above a mid-title match", () => {
    const notes = [note("mid", "The report"), note("prefix", "Report draft")];
    const results = searchNotes(notes, { mid: "", prefix: "" }, "report");
    expect(results[0].note.id).toBe("prefix");
  });

  it("breaks ties by recency (input order)", () => {
    const notes = [note("old", "task list", 1), note("new", "task board", 2)];
    // Neither has a body match; both are prefix title matches on "task", so the
    // earlier (already recency-sorted) note must win the tie.
    const results = searchNotes(notes, { old: "", new: "" }, "task");
    expect(results.map((r) => r.note.id)).toEqual(["old", "new"]);
  });

  it("excludes notes with no match", () => {
    const notes = [note("a", "Cats"), note("b", "Dogs")];
    const results = searchNotes(notes, { a: "meow", b: "woof" }, "fish");
    expect(results).toHaveLength(0);
  });

  it("highlights every occurrence in the title", () => {
    const notes = [note("a", "aba cad aba")];
    const results = searchNotes(notes, { a: "" }, "aba");
    expect(marks(results[0].titleSegments)).toEqual(["aba", "aba"]);
    expect(plain(results[0].titleSegments)).toBe("aba cad aba");
  });

  it("builds a snippet around the first body match with the term highlighted", () => {
    const before = "x".repeat(100);
    const body = `${before} the SECRET keyword lives here ${"y".repeat(100)}`;
    const notes = [note("a", "Doc")];
    const results = searchNotes(notes, { a: body }, "secret");
    const snippet = results[0].snippetSegments;
    // The matched term is highlighted, preserving the body's original casing.
    expect(marks(snippet)).toEqual(["SECRET"]);
    // The excerpt is windowed (not the whole 200+ char body) and ellipsized.
    expect(plain(snippet).length).toBeLessThan(body.length);
    expect(plain(snippet).startsWith("…")).toBe(true);
    expect(plain(snippet).endsWith("…")).toBe(true);
  });

  it("collapses whitespace in snippets", () => {
    const notes = [note("a", "Doc")];
    const results = searchNotes(notes, { a: "line one\n\n  line two   with   gaps" }, "two");
    expect(plain(results[0].snippetSegments)).not.toMatch(/\n/);
    expect(plain(results[0].snippetSegments)).not.toMatch(/ {2,}/);
  });

  it("falls back to the body head for the empty-query snippet", () => {
    const notes = [note("a", "Doc")];
    const results = searchNotes(notes, { a: "first line of the note body" }, "");
    expect(plain(results[0].snippetSegments)).toContain("first line");
    expect(marks(results[0].snippetSegments)).toEqual([]);
  });

  it("tolerates notes missing from the bodies map (treated as empty body)", () => {
    const notes = [note("a", "Title only")];
    const results = searchNotes(notes, {}, "title");
    expect(results).toHaveLength(1);
    expect(results[0].snippetSegments).toEqual([]);
  });
});

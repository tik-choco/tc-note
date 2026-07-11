import { describe, expect, it } from "vitest";
import { computeSlashTrigger, filterSlashItems, type SlashItem } from "../slashMenu";

// slashTriggerWatcher and applySlashTrigger need a live EditorView/DOM to
// exercise directly, and this project's vitest setup runs in plain Node
// with no jsdom (see src/hooks/__tests__/useNoteUrlSync.test.ts). So this
// file focuses entirely on the two pure, DOM-free functions.

describe("computeSlashTrigger", () => {
  it("triggers on a bare slash at the start of the document", () => {
    expect(computeSlashTrigger("/", 1)).toEqual({ from: 0, to: 1, query: "" });
  });

  it("triggers with a query after the slash", () => {
    expect(computeSlashTrigger("/head", 5)).toEqual({ from: 0, to: 5, query: "head" });
  });

  it("triggers on the second line of a multi-line document", () => {
    expect(computeSlashTrigger("hello\n/qu", 10)).toEqual({ from: 6, to: 10, query: "qu" });
  });

  it("does not trigger when the slash is not at the start of the line", () => {
    expect(computeSlashTrigger("a/b", 3)).toBeNull();
  });

  it("does not trigger once a space breaks the run", () => {
    expect(computeSlashTrigger("/foo bar", 8)).toBeNull();
  });

  it("does not trigger when the caret sits mid-query, not at its end", () => {
    expect(computeSlashTrigger("/foo", 2)).toBeNull();
  });

  it("does not trigger on an empty document", () => {
    expect(computeSlashTrigger("", 0)).toBeNull();
  });

  it("returns null when there is no slash at all", () => {
    expect(computeSlashTrigger("hello world", 5)).toBeNull();
  });

  it("returns null before any slash has been typed on the line", () => {
    expect(computeSlashTrigger("/foo", 0)).toBeNull();
  });

  it("supports a multi-line document with several line breaks", () => {
    const doc = "line one\nline two\n/insert";
    const caret = doc.length;
    expect(computeSlashTrigger(doc, caret)).toEqual({
      from: doc.lastIndexOf("/"),
      to: caret,
      query: "insert",
    });
  });

  it("re-triggers correctly on a third line with an empty query", () => {
    const doc = "a\nb\n/";
    expect(computeSlashTrigger(doc, doc.length)).toEqual({ from: 4, to: 5, query: "" });
  });

  it("is Unicode-aware and triggers on a Japanese query", () => {
    const doc = "/見出し";
    expect(computeSlashTrigger(doc, doc.length)).toEqual({ from: 0, to: doc.length, query: "見出し" });
  });

  it("is Unicode-aware on a later line too", () => {
    const doc = "メモ\n/見出し";
    const caret = doc.length;
    expect(computeSlashTrigger(doc, caret)).toEqual({
      from: doc.indexOf("/"),
      to: caret,
      query: "見出し",
    });
  });

  it("breaks the trigger on a full-width space inside a Unicode query", () => {
    // "　" is the CJK ideographic space, a Unicode whitespace character.
    const doc = "/見出　し";
    expect(computeSlashTrigger(doc, doc.length)).toBeNull();
  });

  it("does not trigger when the slash is preceded by other text on the same line", () => {
    expect(computeSlashTrigger("notes: /foo", 11)).toBeNull();
  });

  it("does not trigger with leading whitespace before the slash", () => {
    expect(computeSlashTrigger("  /foo", 6)).toBeNull();
  });

  it("triggers right before a trailing space rather than after it", () => {
    expect(computeSlashTrigger("/foo ", 4)).toEqual({ from: 0, to: 4, query: "foo" });
  });

  it("does not trigger once the caret moves past the trailing space", () => {
    expect(computeSlashTrigger("/foo ", 5)).toBeNull();
  });
});

describe("filterSlashItems", () => {
  const items: SlashItem[] = [
    { key: "h1", label: "Heading 1", insertText: "# " },
    { key: "h2", label: "Heading 2", insertText: "## " },
    { key: "bullet", label: "Bulleted list", insertText: "- " },
    { key: "quote", label: "Quote", insertText: "> " },
  ];

  it("returns all items unfiltered, in order, for an empty query", () => {
    expect(filterSlashItems(items, "")).toEqual(items);
  });

  it("matches case-insensitively as a substring of the label", () => {
    expect(filterSlashItems(items, "head").map((i) => i.key)).toEqual(["h1", "h2"]);
    expect(filterSlashItems(items, "HEAD").map((i) => i.key)).toEqual(["h1", "h2"]);
  });

  it("matches a substring anywhere in the label", () => {
    expect(filterSlashItems(items, "list").map((i) => i.key)).toEqual(["bullet"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterSlashItems(items, "zzz")).toEqual([]);
  });

  it("returns an empty array for an empty items array regardless of query", () => {
    expect(filterSlashItems([], "")).toEqual([]);
    expect(filterSlashItems([], "heading")).toEqual([]);
  });

  it("matches non-ASCII (Japanese) queries against non-ASCII labels", () => {
    const jaItems: SlashItem[] = [
      { key: "h1", label: "見出し1", insertText: "# " },
      { key: "quote", label: "引用", insertText: "> " },
    ];
    expect(filterSlashItems(jaItems, "見出し").map((i) => i.key)).toEqual(["h1"]);
    expect(filterSlashItems(jaItems, "引用").map((i) => i.key)).toEqual(["quote"]);
  });
});

import { describe, it, expect } from "vitest";
import { insertPasteAtCursor } from "../blocks";

const smart = { splitIntoBlocks: true };
const raw = { splitIntoBlocks: false };

describe("insertPasteAtCursor — single-block (inline) pastes", () => {
  it("inserts single-line text at the end of a block", () => {
    const r = insertPasteAtCursor(["abc"], 0, 3, 3, "XYZ", smart);
    expect(r.blocks).toEqual(["abcXYZ"]);
    expect(r.activeIndex).toBe(0);
    expect(r.caret).toBe(6);
  });

  it("inserts at the middle of a block", () => {
    const r = insertPasteAtCursor(["abcd"], 0, 2, 2, "XY", smart);
    expect(r.blocks).toEqual(["abXYcd"]);
    expect(r.caret).toBe(4);
  });

  it("inserts at the start of a block", () => {
    const r = insertPasteAtCursor(["abc"], 0, 0, 0, "XY", smart);
    expect(r.blocks).toEqual(["XYabc"]);
    expect(r.caret).toBe(2);
  });

  it("preserves intra-block single newlines (single paragraph stays one block)", () => {
    const r = insertPasteAtCursor([""], 0, 0, 0, "line1\nline2", smart);
    expect(r.blocks).toEqual(["line1\nline2"]);
    expect(r.activeIndex).toBe(0);
    expect(r.caret).toBe("line1\nline2".length);
  });

  it("leaves other blocks untouched", () => {
    const r = insertPasteAtCursor(["a", "b", "c"], 1, 1, 1, "X", smart);
    expect(r.blocks).toEqual(["a", "bX", "c"]);
    expect(r.activeIndex).toBe(1);
  });
});

describe("insertPasteAtCursor — selection replacement", () => {
  it("replaces the selected range before inserting", () => {
    const r = insertPasteAtCursor(["abcdef"], 0, 1, 4, "X", smart);
    expect(r.blocks).toEqual(["aXef"]);
    expect(r.caret).toBe(2);
  });

  it("tolerates a reversed selection (start > end)", () => {
    const r = insertPasteAtCursor(["abcdef"], 0, 4, 1, "X", smart);
    expect(r.blocks).toEqual(["aXef"]);
    expect(r.caret).toBe(2);
  });

  it("replaces a selection with multi-paragraph content", () => {
    const r = insertPasteAtCursor(["abcdef"], 0, 1, 4, "P\n\nQ", smart);
    expect(r.blocks).toEqual(["aP", "Qef"]);
    expect(r.activeIndex).toBe(1);
    expect(r.caret).toBe(1); // end of "Q" in "Qef"
  });
});

describe("insertPasteAtCursor — multi-paragraph pastes split into blocks", () => {
  it("splits blank-line-separated paragraphs into new blocks", () => {
    const r = insertPasteAtCursor([""], 0, 0, 0, "p1\n\np2\n\np3", smart);
    expect(r.blocks).toEqual(["p1", "p2", "p3"]);
    expect(r.activeIndex).toBe(2);
    expect(r.caret).toBe(2);
  });

  it("keeps before-caret + first segment in the current block and after-caret with the last", () => {
    const r = insertPasteAtCursor(["HelloWorld"], 0, 5, 5, "a\n\nb", smart);
    expect(r.blocks).toEqual(["Helloa", "bWorld"]);
    expect(r.activeIndex).toBe(1);
    expect(r.caret).toBe(1); // just after "b", before "World"
  });

  it("shifts trailing blocks and reports the correct active index", () => {
    const r = insertPasteAtCursor(["A", "B"], 0, 1, 1, "x\n\ny", smart);
    expect(r.blocks).toEqual(["Ax", "y", "B"]);
    expect(r.activeIndex).toBe(1);
    expect(r.caret).toBe(1);
  });

  it("drops trailing blank lines rather than emitting empty blocks", () => {
    const r = insertPasteAtCursor([""], 0, 0, 0, "a\n\nb\n\n", smart);
    expect(r.blocks).toEqual(["a", "b"]);
    expect(r.activeIndex).toBe(1);
    expect(r.caret).toBe(1);
  });

  it("drops leading blank lines from a single-paragraph paste (stays inline)", () => {
    const r = insertPasteAtCursor(["X"], 0, 1, 1, "\n\na", smart);
    expect(r.blocks).toEqual(["Xa"]);
    expect(r.activeIndex).toBe(0);
    expect(r.caret).toBe(2);
  });
});

describe("insertPasteAtCursor — fenced code blocks", () => {
  it("keeps a fenced code block whole even with a blank line inside it", () => {
    const code = "```js\nconst x = 1;\n\nconst y = 2;\n```";
    const r = insertPasteAtCursor([""], 0, 0, 0, code, smart);
    expect(r.blocks).toEqual([code]);
    expect(r.activeIndex).toBe(0);
    expect(r.caret).toBe(code.length);
  });

  it("splits text around a fenced code block into separate blocks", () => {
    const r = insertPasteAtCursor([""], 0, 0, 0, "intro\n\n```\ncode\n```\n\noutro", smart);
    expect(r.blocks).toEqual(["intro", "```\ncode\n```", "outro"]);
    expect(r.activeIndex).toBe(2);
    expect(r.caret).toBe("outro".length);
  });
});

describe("insertPasteAtCursor — raw paste (splitIntoBlocks: false)", () => {
  it("keeps blank-line-separated content in a single block", () => {
    const r = insertPasteAtCursor([""], 0, 0, 0, "a\n\nb", raw);
    expect(r.blocks).toEqual(["a\n\nb"]);
    expect(r.activeIndex).toBe(0);
    expect(r.caret).toBe(4);
  });

  it("keeps a fenced code block literal without splitting", () => {
    const code = "```\nline1\n\nline2\n```";
    const r = insertPasteAtCursor(["x"], 0, 1, 1, code, raw);
    expect(r.blocks).toEqual(["x" + code]);
    expect(r.caret).toBe(1 + code.length);
  });
});

describe("insertPasteAtCursor — normalization and edge cases", () => {
  it("normalizes CRLF and lone CR to LF (raw)", () => {
    const r = insertPasteAtCursor([""], 0, 0, 0, "a\r\nb\rc", raw);
    expect(r.blocks).toEqual(["a\nb\nc"]);
  });

  it("normalizes CRLF before splitting into blocks (smart)", () => {
    const r = insertPasteAtCursor([""], 0, 0, 0, "a\r\n\r\nb", smart);
    expect(r.blocks).toEqual(["a", "b"]);
  });

  it("is a no-op insert for empty clipboard text", () => {
    const r = insertPasteAtCursor(["ab"], 0, 1, 1, "", smart);
    expect(r.blocks).toEqual(["ab"]);
    expect(r.caret).toBe(1);
  });

  it("removes the selected range even when pasting empty text", () => {
    const r = insertPasteAtCursor(["abcdef"], 0, 1, 4, "", smart);
    expect(r.blocks).toEqual(["aef"]);
    expect(r.caret).toBe(1);
  });

  it("clamps an out-of-range block index and caret", () => {
    const r = insertPasteAtCursor(["a", "b"], 9, 100, 100, "X", smart);
    expect(r.blocks).toEqual(["a", "bX"]);
    expect(r.activeIndex).toBe(1);
    expect(r.caret).toBe(2);
  });
});

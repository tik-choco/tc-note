import { describe, it, expect } from "vitest";
import { splitBlocks, isInsideOpenMathFence } from "../blocks";

describe("splitBlocks -- display math fences", () => {
  it("keeps a $$ block with a blank line inside intact", () => {
    const md = "$$\nx = 1\n\ny = 2\n$$";
    expect(splitBlocks(md)).toEqual([md]);
  });
  it("keeps the empty-middle-line $$ scaffold as one block", () => {
    expect(splitBlocks("$$\n\n$$")).toEqual(["$$\n\n$$"]);
  });
  it("still splits normal paragraphs on blank lines", () => {
    expect(splitBlocks("a\n\nb")).toEqual(["a", "b"]);
  });
  it("does not treat single-line $$...$$ as a fence", () => {
    expect(splitBlocks("$$a^2$$\n\nnext")).toEqual(["$$a^2$$", "next"]);
  });
  it("ignores $$ inside a code fence", () => {
    const md = "```\n$$\n```";
    expect(splitBlocks(md)).toEqual([md]);
  });
});

describe("isInsideOpenMathFence", () => {
  it("is true after an opening $$", () => {
    expect(isInsideOpenMathFence("$$")).toBe(true);
    expect(isInsideOpenMathFence("intro\n$$\nx=1")).toBe(true);
  });
  it("is false once the block is closed", () => {
    expect(isInsideOpenMathFence("$$\nx=1\n$$")).toBe(false);
  });
  it("is false for single-line $$...$$", () => {
    expect(isInsideOpenMathFence("$$a^2$$")).toBe(false);
  });
});

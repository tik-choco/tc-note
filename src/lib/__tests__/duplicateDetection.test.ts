import { describe, it, expect } from "vitest";
import { findDuplicateSentences } from "../duplicateDetection";

describe("findDuplicateSentences", () => {
  it("finds an exact duplicate sentence across two blocks", () => {
    const blocks = [
      "This is a sentence that is long enough to matter.",
      "Some other paragraph. This is a sentence that is long enough to matter.",
    ];
    const matches = findDuplicateSentences(blocks);
    expect(matches.length).toBeGreaterThan(0);
    const exact = matches.find((m) => m.similarity === 1);
    expect(exact).toBeDefined();
    expect(exact?.a.blockIndex).toBe(0);
    expect(exact?.b.blockIndex).toBe(1);
  });

  it("finds a lightly reworded near-duplicate", () => {
    const blocks = [
      "The quick brown fox jumps over the lazy dog every single morning.",
      "The quick brown fox jumped over the lazy dog every single morning.",
    ];
    const matches = findDuplicateSentences(blocks);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].similarity).toBeGreaterThanOrEqual(0.82);
    expect(matches[0].similarity).toBeLessThan(1);
  });

  it("does not flag two short unrelated sentences", () => {
    const blocks = ["Yes.", "No way."];
    const matches = findDuplicateSentences(blocks);
    expect(matches).toEqual([]);
  });

  it("does not flag two longer, unrelated sentences", () => {
    const blocks = [
      "The cat sat quietly on the warm windowsill all afternoon.",
      "Quantum entanglement puzzled physicists for decades.",
    ];
    const matches = findDuplicateSentences(blocks);
    expect(matches).toEqual([]);
  });

  it("ignores content inside a fenced code block", () => {
    const blocks = [
      "```\nThis is a sentence that is long enough to matter.\n```",
      "This is a sentence that is long enough to matter.",
    ];
    const matches = findDuplicateSentences(blocks);
    expect(matches).toEqual([]);
  });

  it("does not flag a sentence against itself within the same block", () => {
    const blocks = ["This is a sentence that is long enough to matter."];
    const matches = findDuplicateSentences(blocks);
    expect(matches).toEqual([]);
  });

  it("finds an exact duplicate CJK sentence (fullwidth terminator at end-of-block)", () => {
    // CJK prose has no space after 。 mid-paragraph, so a terminator only
    // splits a sentence off when it's followed by whitespace or EOL (per
    // spec) — here each block is exactly one sentence ending the block.
    const blocks = ["これは十分に長いテスト用の文章です。", "これは十分に長いテスト用の文章です。"];
    const matches = findDuplicateSentences(blocks);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].similarity).toBe(1);
  });
});

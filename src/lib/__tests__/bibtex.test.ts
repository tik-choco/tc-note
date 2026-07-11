import { describe, it, expect } from "vitest";
import { bibtexSource, collectBibliography, isBibtexBlock, parseBibtex } from "../bibtex";

describe("isBibtexBlock", () => {
  it("accepts a fenced bibtex block", () => {
    expect(isBibtexBlock("```bibtex\n@article{doe2020, title = {X}}\n```")).toBe(true);
  });

  it("rejects a non-bibtex fenced block", () => {
    expect(isBibtexBlock("```js\nconsole.log(1)\n```")).toBe(false);
  });

  it("rejects bare @key{...} text outside a fence", () => {
    expect(isBibtexBlock("@article{doe2020, title = {X}}")).toBe(false);
  });

  it("rejects plain prose mentioning an @mention", () => {
    expect(isBibtexBlock("thanks @doe2020 for the help")).toBe(false);
  });

  it("rejects an unterminated bibtex fence", () => {
    expect(isBibtexBlock("```bibtex\n@article{doe2020, title = {X}}")).toBe(false);
  });
});

describe("bibtexSource", () => {
  it("strips the opening and closing fences", () => {
    expect(bibtexSource("```bibtex\n@article{doe2020, title = {X}}\n```")).toBe("@article{doe2020, title = {X}}\n");
  });
});

describe("parseBibtex", () => {
  it("parses a single entry with braced values", () => {
    const entries = parseBibtex('@article{doe2020, title = {A Study}, author = {Jane Doe}, year = {2020}}');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      key: "doe2020",
      type: "article",
      fields: { title: "A Study", author: "Jane Doe", year: "2020" },
    });
  });

  it("parses multiple entries in one block", () => {
    const source = `
@article{doe2020, title = {First}, year = {2020}}
@book{smith1999, title = {Second}, year = {1999}}
`;
    const entries = parseBibtex(source);
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe("doe2020");
    expect(entries[0].type).toBe("article");
    expect(entries[1].key).toBe("smith1999");
    expect(entries[1].type).toBe("book");
  });

  it("handles quoted, braced, and bare field values", () => {
    const entries = parseBibtex('@misc{k1, title = "Quoted", author = {Braced}, year = 2021}');
    expect(entries[0].fields).toEqual({ title: "Quoted", author: "Braced", year: "2021" });
  });

  it("handles a title with nested braces", () => {
    const entries = parseBibtex("@article{k1, title = {A {Study} of X}}");
    expect(entries[0].fields.title).toBe("A {Study} of X");
  });

  it("ignores %-prefixed comment lines", () => {
    const source = `
% this whole line is a comment
@article{k1, title = {Kept}}
`;
    const entries = parseBibtex(source);
    expect(entries).toHaveLength(1);
    expect(entries[0].fields.title).toBe("Kept");
  });

  it("handles a trailing comma before the closing brace", () => {
    const entries = parseBibtex("@article{k1, title = {X}, year = {2020},}");
    expect(entries[0].fields).toEqual({ title: "X", year: "2020" });
  });

  it("leaves a missing optional field simply absent, without crashing", () => {
    const entries = parseBibtex("@article{k1, title = {Only Title}}");
    expect(entries[0].fields.title).toBe("Only Title");
    expect(entries[0].fields.author).toBeUndefined();
    expect(entries[0].fields.journal).toBeUndefined();
  });

  it("returns an empty array for text with no entries", () => {
    expect(parseBibtex("just some prose, no entries here")).toEqual([]);
  });

  it("lowercases the entry type and field names", () => {
    const entries = parseBibtex("@ARTICLE{k1, TITLE = {X}, Author = {Y}}");
    expect(entries[0].type).toBe("article");
    expect(entries[0].fields).toEqual({ title: "X", author: "Y" });
  });
});

describe("collectBibliography", () => {
  it("merges entries from two separate bibtex blocks", () => {
    const blocks = [
      "some prose",
      "```bibtex\n@article{a1, title = {A}}\n```",
      "```bibtex\n@article{b1, title = {B}}\n```",
    ];
    const bib = collectBibliography(blocks);
    expect(bib.size).toBe(2);
    expect(bib.get("a1")?.fields.title).toBe("A");
    expect(bib.get("b1")?.fields.title).toBe("B");
  });

  it("keeps the first occurrence when the same key appears more than once", () => {
    const blocks = [
      "```bibtex\n@article{dup, title = {First}}\n```",
      "```bibtex\n@article{dup, title = {Second}}\n```",
    ];
    const bib = collectBibliography(blocks);
    expect(bib.size).toBe(1);
    expect(bib.get("dup")?.fields.title).toBe("First");
  });

  it("ignores blocks that aren't bibtex fences", () => {
    const blocks = ["# heading", "```js\nconsole.log(1)\n```"];
    expect(collectBibliography(blocks).size).toBe(0);
  });
});

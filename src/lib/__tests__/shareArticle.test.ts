import { describe, it, expect } from "vitest";
import { buildArticleExcerpt, ARTICLE_EXCERPT_MAX_LENGTH } from "../shareArticle";

describe("buildArticleExcerpt", () => {
  it("strips common Markdown syntax down to plain text", () => {
    const markdown = [
      "# Heading",
      "",
      "Some **bold** and *italic* text with a [link](https://example.com).",
      "",
      "- bullet one",
      "- bullet two",
    ].join("\n");

    const excerpt = buildArticleExcerpt(markdown);
    expect(excerpt).toBe("Heading Some bold and italic text with a link. bullet one bullet two");
  });

  it("truncates to the ~200 char excerpt limit", () => {
    const markdown = "a".repeat(500);
    const excerpt = buildArticleExcerpt(markdown);
    expect(excerpt.length).toBe(ARTICLE_EXCERPT_MAX_LENGTH);
  });

  it("collapses fenced code blocks and inline code to whitespace/plain text", () => {
    const markdown = "before\n```js\nconst x = 1;\n```\nafter `inline` code";
    const excerpt = buildArticleExcerpt(markdown);
    expect(excerpt).toBe("before after inline code");
  });

  it("returns an empty string for empty/whitespace-only input", () => {
    expect(buildArticleExcerpt("")).toBe("");
    expect(buildArticleExcerpt("   \n\n  ")).toBe("");
  });
});

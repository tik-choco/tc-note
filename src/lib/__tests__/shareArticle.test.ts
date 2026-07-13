import { describe, it, expect, beforeEach, vi } from "vitest";

const { ensureMistNode } = vi.hoisted(() => ({ ensureMistNode: vi.fn() }));
vi.mock("../mistNode", () => ({ ensureMistNode }));

const { storage_add } = vi.hoisted(() => ({ storage_add: vi.fn() }));
vi.mock("../../vendor/mistlib/wrappers/web/index.js", () => ({ storage_add }));

const { publishShared } = vi.hoisted(() => ({ publishShared: vi.fn() }));
vi.mock("../sharedBus", () => ({ publishShared }));

import { buildArticleExcerpt, ARTICLE_EXCERPT_MAX_LENGTH, shareNoteAsArticle } from "../shareArticle";

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

describe("shareNoteAsArticle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureMistNode.mockResolvedValue(undefined);
  });

  it("publishes a cid-only record (no inline body) on success", async () => {
    storage_add.mockResolvedValue("bafy-article-1");

    await shareNoteAsArticle("My Note", "full markdown body");

    expect(publishShared).toHaveBeenCalledTimes(1);
    const [topic, cid, meta] = publishShared.mock.calls[0];
    expect(topic).toBe("note-article");
    expect(cid).toBe("bafy-article-1");
    expect(meta).not.toHaveProperty("text");
    expect(meta.title).toBe("My Note");
  });

  it("skips publishing and rethrows when storage_add fails, instead of inlining the note body", async () => {
    storage_add.mockRejectedValue(new Error("opfs unavailable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(shareNoteAsArticle("My Note", "a".repeat(10_000))).rejects.toThrow("opfs unavailable");

    expect(publishShared).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

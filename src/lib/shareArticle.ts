// Publishes the current note onto the shared bus's "note-article" topic so a
// tc-chat tab on the same origin can pick it up and post it as a board node.
// See protocol/docs/data-contracts/docs/SHARED_BUS.md for the full contract.
//
// Contract (fixed): full note markdown is written to the mistlib OPFS block
// store via storage_add to get a CID, then publishShared("note-article", cid,
// meta) is called with meta = { title, format: "markdown", excerpt, publishedAt }.
// If storage_add fails or mistlib is unavailable, we fall back to cid: "" and
// inline the full markdown as meta.text — the tc-chat consumer must handle
// both shapes.
import { storage_add } from "../vendor/mistlib/wrappers/web/index.js";
import { ensureMistNode } from "./mistNode";
import { markdownToPlainText } from "./mistlib";
import { publishShared } from "./sharedBus";

export const ARTICLE_EXCERPT_MAX_LENGTH = 200;

/** Plain-text excerpt (~200 chars) used for the shared record's `meta.excerpt`. */
export function buildArticleExcerpt(markdown: string): string {
  return markdownToPlainText(markdown, ARTICLE_EXCERPT_MAX_LENGTH);
}

/**
 * Publishes `markdown` (with `title`) as a "note-article" shared record.
 * Tries to content-address the body via mistlib's storage_add first; if that
 * throws (e.g. OPFS/wasm unavailable), falls back to inlining the markdown in
 * `meta.text` with `cid: ""`, per the shared-bus contract for this topic.
 */
export async function shareNoteAsArticle(title: string, markdown: string): Promise<void> {
  const meta: Record<string, unknown> = {
    title,
    format: "markdown",
    excerpt: buildArticleExcerpt(markdown),
    publishedAt: new Date().toISOString(),
  };

  let cid = "";
  try {
    await ensureMistNode();
    cid = await storage_add(`note-article-${Date.now()}.md`, new TextEncoder().encode(markdown));
  } catch (error) {
    console.warn("shareNoteAsArticle: storage_add failed, falling back to inline text", error);
    cid = "";
  }

  if (!cid) {
    meta.text = markdown;
  }

  publishShared("note-article", cid, meta);
}

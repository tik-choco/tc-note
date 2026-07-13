// Publishes the current note onto the shared bus's "note-article" topic so a
// tc-chat tab on the same origin can pick it up and post it as a board node.
// See protocol/docs/data-contracts/docs/SHARED_BUS.md for the full contract.
//
// Contract: full note markdown is written to the mistlib OPFS block store via
// storage_add to get a CID, then publishShared("note-article", cid, meta) is
// called with meta = { title, format: "markdown", excerpt, publishedAt }.
//
// If storage_add fails or mistlib is unavailable, the share is skipped
// entirely rather than falling back to inlining the full note body in
// meta.text: an unbounded note could otherwise land whole in the shared
// localStorage record and blow the origin's quota (see storage-fix-spec's
// dual-read/quota rules). The caller (app.tsx's handleShareArticle) already
// catches and surfaces a "share failed" toast on any thrown error.
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
 * Content-addresses the body via mistlib's storage_add first; if that throws
 * (e.g. OPFS/wasm unavailable), the share is skipped (no publishShared call)
 * and the error is re-thrown after a console.warn, so the caller's existing
 * failure handling (a toast) fires instead of silently succeeding with
 * nothing actually shared.
 */
export async function shareNoteAsArticle(title: string, markdown: string): Promise<void> {
  const meta: Record<string, unknown> = {
    title,
    format: "markdown",
    excerpt: buildArticleExcerpt(markdown),
    publishedAt: new Date().toISOString(),
  };

  let cid: string;
  try {
    await ensureMistNode();
    cid = await storage_add(`note-article-${Date.now()}.md`, new TextEncoder().encode(markdown));
  } catch (error) {
    console.warn("shareNoteAsArticle: storage_add failed, skipping share (not inlining note body)", error);
    throw error;
  }

  publishShared("note-article", cid, meta);
}

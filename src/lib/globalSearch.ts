// Pure, DOM-free ranking + snippet logic for the global full-text search
// (Ctrl+Shift+F). Kept separate from the modal so it can be unit-tested in
// plain Node: given the note metadata list and a map of note id -> body text,
// `searchNotes` returns ranked results with pre-split highlight segments for
// both the title and a body excerpt around the first match.

import type { NoteMeta } from "./mistlib";

/** One run of text in a title/snippet, flagged whether it matched the query.
 *  The UI renders `match: true` runs inside <mark>. */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

export interface SearchResult {
  note: NoteMeta;
  /** The note title, split so matched spans can be highlighted. */
  titleSegments: HighlightSegment[];
  /** A body excerpt around the first match (or the body head when there's no
   *  body match / no query), split so matched spans can be highlighted. May be
   *  empty when the note has no body text. */
  snippetSegments: HighlightSegment[];
  /** Higher ranks first. 0 means "shown without a query" (recent list). */
  score: number;
}

// How much of the body to show in a snippet, and how much context to keep
// before the first match so the matched term isn't flush against the edge.
const SNIPPET_MAX_LEN = 160;
const SNIPPET_CONTEXT_BEFORE = 40;

/** Case-insensitive, length-preserving fold so match indices stay valid
 *  against the original string (toLowerCase keeps a 1:1 mapping for the
 *  scripts we support, unlike NFKC/NFD which shift offsets). */
function fold(text: string): string {
  return text.toLowerCase();
}

/** Splits `text` into matched / unmatched runs against an already-folded
 *  query. Returns a single unmatched run when the query is empty or absent. */
function toSegments(text: string, foldedQuery: string): HighlightSegment[] {
  if (!foldedQuery) return text ? [{ text, match: false }] : [];
  const hay = fold(text);
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = hay.indexOf(foldedQuery, cursor);
    if (idx < 0) {
      segments.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), match: false });
    segments.push({ text: text.slice(idx, idx + foldedQuery.length), match: true });
    cursor = idx + foldedQuery.length;
  }
  return segments.length ? segments : [{ text, match: false }];
}

/** Counts non-overlapping occurrences of `foldedQuery` in an already-folded
 *  haystack. */
function countMatches(foldedHay: string, foldedQuery: string): number {
  if (!foldedQuery) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = foldedHay.indexOf(foldedQuery, from);
    if (idx < 0) break;
    count++;
    from = idx + foldedQuery.length;
  }
  return count;
}

/** Builds a body snippet as highlight segments. When there's a match, the
 *  excerpt is centered on the first occurrence with leading/trailing ellipses;
 *  otherwise it falls back to the head of the body. Whitespace is collapsed so
 *  multi-line markdown reads as a single tidy line. */
function buildSnippetSegments(body: string, foldedQuery: string): HighlightSegment[] {
  if (!body) return [];

  const foldedBody = fold(body);
  const matchIdx = foldedQuery ? foldedBody.indexOf(foldedQuery) : -1;

  if (matchIdx < 0) {
    // No body match (or empty query): show the start of the body.
    const head = body.slice(0, SNIPPET_MAX_LEN).replace(/\s+/g, " ").trim();
    if (!head) return [];
    const segments: HighlightSegment[] = [{ text: head, match: false }];
    if (body.replace(/\s+/g, " ").trim().length > head.length) {
      segments.push({ text: "…", match: false });
    }
    return segments;
  }

  const start = Math.max(0, matchIdx - SNIPPET_CONTEXT_BEFORE);
  const end = Math.min(body.length, start + SNIPPET_MAX_LEN);
  const excerpt = body.slice(start, end).replace(/\s+/g, " ").trim();

  const segments: HighlightSegment[] = [];
  if (start > 0) segments.push({ text: "…", match: false });
  segments.push(...toSegments(excerpt, foldedQuery));
  if (end < body.length) segments.push({ text: "…", match: false });
  return segments;
}

/**
 * Ranks notes by matches in title + body for `query`, returning at most
 * `limit` results. A title match outranks a body-only match; a title match
 * that starts at the beginning outranks one in the middle; ties break by
 * recency (input order, which `listNotes` already sorts newest-first).
 *
 * With an empty query, returns the first `limit` notes untouched (a recent
 * "quick switcher"), each with a plain body-head snippet.
 */
export function searchNotes(
  notes: NoteMeta[],
  bodies: Record<string, string>,
  query: string,
  limit = 50,
): SearchResult[] {
  const foldedQuery = fold(query.trim());

  if (!foldedQuery) {
    return notes.slice(0, limit).map((note) => ({
      note,
      titleSegments: [{ text: note.title, match: false }],
      snippetSegments: buildSnippetSegments(bodies[note.id] ?? "", ""),
      score: 0,
    }));
  }

  const scored: SearchResult[] = [];
  // Preserve the incoming (recency) order as a stable tiebreaker.
  notes.forEach((note, order) => {
    const body = bodies[note.id] ?? "";
    const foldedTitle = fold(note.title);
    const foldedBody = fold(body);

    const titleIdx = foldedTitle.indexOf(foldedQuery);
    const titleCount = countMatches(foldedTitle, foldedQuery);
    const bodyCount = countMatches(foldedBody, foldedQuery);

    if (titleIdx < 0 && bodyCount === 0) return;

    let score = 0;
    if (titleIdx >= 0) {
      score += 1000;
      if (titleIdx === 0) score += 500;
      score += titleCount * 10;
    }
    score += bodyCount;

    scored.push({
      note,
      titleSegments: toSegments(note.title, foldedQuery),
      snippetSegments: buildSnippetSegments(body, foldedQuery),
      // Fold the original order into the score so the sort below is stable
      // across engines: a tiny fractional recency term never crosses a whole
      // match-weight boundary.
      score: score + (notes.length - order) / (notes.length + 1),
    });
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

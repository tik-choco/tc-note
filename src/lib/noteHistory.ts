// Per-note version history. mistlib is content-addressed only — every
// storage_add call from saveNote() already writes an immutable blob and
// returns a CID, and old CIDs are never deleted. So every past version of
// every note is already durably stored; nothing keeps a pointer to it. This
// module is that pointer list.
//
// Kept in its own localStorage key, deliberately separate from mistlib.ts's
// note index (`tc-note:index`): the index is read on every render and is the
// app's single point of failure, so it stays small and its shape unchanged.
// History is looked at far less often and can afford to carry more data.
import { storage_get } from "../vendor/mistlib/wrappers/web/index.js";
import { ensureMistNode } from "./mistNode";

const HISTORY_KEY = "tc-note:history";
// Duplicated from mistlib.ts's own INDEX_KEY rather than imported: mistlib.ts
// calls into this module (saveNote/deleteNote), so importing mistlib.ts here
// would create a cycle. Both constants must be kept in sync by hand.
const INDEX_KEY = "tc-note:index";

// Age-bucketed retention (see thinHistory): fine-grained for recent edits,
// coarser the further back you go, gone past a month. An entry is a CID plus
// two numbers — well under 100 bytes — so the limiting factor is "how far
// back does 'undo' meaningfully reach," not storage cost.
const RECENT_WINDOW_MS = 10 * 60 * 1000; // keep every version from the last 10 minutes
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOURLY_HORIZON_MS = DAY_MS; // 10 min .. 24h: at most one entry per hour
const DAILY_HORIZON_MS = 30 * DAY_MS; // 24h .. 30 days: at most one entry per day
// Absolute ceiling regardless of bucketing, so a pathological clock or a bulk
// import can't grow a single note's history without bound.
const OVERALL_CAP = 100;

export interface HistoryEntry {
  cid: string;
  at: number;
  /** character count of the Markdown at this version, for the list's display. */
  chars: number;
}

type HistoryMap = Record<string, HistoryEntry[]>;

// --- pure logic (unit-testable without localStorage) ---------------------

/**
 * Returns `entries` (newest first) with a new version prepended. A no-op
 * (returns `entries` unchanged) when `cid` matches the newest entry already
 * there — saves are frequent and often produce byte-identical content (e.g.
 * autosave firing on an unfocused blur with nothing new typed), and
 * content-addressing means an unchanged save always reproduces the exact
 * same CID, so this is a cheap and exact way to skip recording a duplicate.
 * Size limiting is thinHistory's job, not this function's — call it next.
 */
export function addHistoryEntry(
  entries: HistoryEntry[],
  cid: string,
  chars: number,
  now: number = Date.now(),
): HistoryEntry[] {
  if (entries[0]?.cid === cid) return entries;
  return [{ cid, at: now, chars }, ...entries];
}

/**
 * Thins `entries` (any order in, newest-first out) by age relative to `now`:
 *   - under 10 minutes old: every entry is kept, for fine-grained undo while
 *     actively editing;
 *   - 10 minutes to 24 hours old: at most one entry per hour (the newest in
 *     that hour survives);
 *   - 24 hours to 30 days old: at most one entry per day (the newest that
 *     day survives);
 *   - older than 30 days: dropped.
 * The single newest entry overall is always kept regardless of its age — a
 * note untouched for months should still have *something* to show as
 * "current" — and the result is capped at `OVERALL_CAP` as a last-resort
 * safety net against unbounded growth.
 *
 * Pure and deterministic in `now`: the caller passes the clock reading
 * rather than this function reading it itself, so the bucket-boundary
 * behavior (a prime spot for off-by-one bugs) is exhaustively testable.
 * Tolerates entries in any order or shape produced by an older version of
 * this module (which only had a flat 20-entry cap) — sorting by `at` first
 * means stale/misordered stored data thins correctly rather than throwing
 * or silently misbehaving.
 */
export function thinHistory(entries: HistoryEntry[], now: number): HistoryEntry[] {
  if (entries.length === 0) return entries;
  const sorted = [...entries].sort((a, b) => b.at - a.at);

  const kept: HistoryEntry[] = [];
  // Bucket keys already represented in `kept`. Entries are processed
  // newest-first, so the first entry to claim a bucket is always that
  // bucket's newest member — including the overall-newest entry itself,
  // which registers its own bucket (if any) before any older entry can also
  // land in it.
  const seenBuckets = new Set<string>();

  sorted.forEach((entry, index) => {
    const age = now - entry.at;

    if (age < RECENT_WINDOW_MS) {
      kept.push(entry); // recent window: no bucketing, everything survives
      return;
    }

    let bucket: string | undefined;
    if (age < HOURLY_HORIZON_MS) {
      bucket = `h:${Math.floor(entry.at / HOUR_MS)}`;
    } else if (age < DAILY_HORIZON_MS) {
      bucket = `d:${Math.floor(entry.at / DAY_MS)}`;
    }
    // else: older than 30 days — no bucket, dropped below unless newest.

    if (bucket) {
      if (seenBuckets.has(bucket)) return; // a newer entry already covers this hour/day
      seenBuckets.add(bucket);
      kept.push(entry);
      return;
    }

    if (index === 0) kept.push(entry); // never drop the single newest entry overall
  });

  return kept.length > OVERALL_CAP ? kept.slice(0, OVERALL_CAP) : kept;
}

/** Drops every key not in `knownIds` — keeps the history store from growing
 * without bound as notes are deleted through paths that predate this module,
 * or restored/deleted repeatedly. */
export function pruneHistoryMap(map: HistoryMap, knownIds: ReadonlySet<string>): HistoryMap {
  const next: HistoryMap = {};
  for (const [id, entries] of Object.entries(map)) {
    if (knownIds.has(id)) next[id] = entries;
  }
  return next;
}

// --- localStorage-backed I/O ----------------------------------------------

function loadHistoryMap(): HistoryMap {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as HistoryMap;
  } catch {
    return {};
  }
}

function saveHistoryMap(map: HistoryMap): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(map));
}

function loadKnownNoteIds(): Set<string> {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .map((n: unknown) => (n && typeof n === "object" ? (n as { id?: unknown }).id : undefined))
        .filter((id): id is string => typeof id === "string"),
    );
  } catch {
    return new Set();
  }
}

/**
 * Records a new version for `noteId`. No-op if `cid` is identical to the
 * most recently recorded version (see addHistoryEntry). The resulting list
 * is thinned by age (see thinHistory) on every write — this is also what
 * keeps an old, pre-thinning stored list (this module used to have a flat
 * 20-entry cap) well-behaved: the next write thins it down to the current
 * rule instead of leaving it in its old shape indefinitely. Also prunes any
 * note ids no longer present in mistlib's note index, so the history store
 * doesn't grow forever off notes that were deleted before this module
 * existed or through a path that didn't call clearHistory.
 */
export function recordVersion(noteId: string, cid: string, chars: number): void {
  const map = loadHistoryMap();
  const now = Date.now();
  const entries = thinHistory(addHistoryEntry(map[noteId] ?? [], cid, chars, now), now);
  const next: HistoryMap = { ...map, [noteId]: entries };
  const known = loadKnownNoteIds();
  known.add(noteId); // saveNote() writes the index before calling this, but don't depend on ordering.
  saveHistoryMap(pruneHistoryMap(next, known));
}

/** All recorded versions for `noteId`, newest first. Empty if none. */
export function listVersions(noteId: string): HistoryEntry[] {
  return loadHistoryMap()[noteId] ?? [];
}

/** Drops all recorded versions for `noteId` (called from mistlib's deleteNote). */
export function clearHistory(noteId: string): void {
  const map = loadHistoryMap();
  if (!(noteId in map)) return;
  const next = { ...map };
  delete next[noteId];
  saveHistoryMap(next);
}

/** Fetches a past version's bytes from mistlib's content store and decodes
 * them back to the Markdown string. */
export async function loadVersion(cid: string): Promise<string> {
  await ensureMistNode();
  const bytes: Uint8Array = await storage_get(cid);
  return new TextDecoder().decode(bytes);
}

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

// Cap per note, not overall — a handful of frequently-edited notes shouldn't
// crowd out history for everything else.
const HISTORY_CAP = 20;

export interface HistoryEntry {
  cid: string;
  at: number;
  /** character count of the Markdown at this version, for the list's display. */
  chars: number;
}

type HistoryMap = Record<string, HistoryEntry[]>;

// --- pure logic (unit-testable without localStorage) ---------------------

/**
 * Returns `entries` (newest first) with a new version prepended, capped at
 * `cap`. A no-op (returns `entries` unchanged) when `cid` matches the newest
 * entry already there — saves are frequent and often produce byte-identical
 * content (e.g. autosave firing on an unfocused blur with nothing new typed),
 * and content-addressing means an unchanged save always reproduces the exact
 * same CID, so this is a cheap and exact way to skip recording a duplicate.
 */
export function addHistoryEntry(
  entries: HistoryEntry[],
  cid: string,
  chars: number,
  now: number = Date.now(),
  cap: number = HISTORY_CAP,
): HistoryEntry[] {
  if (entries[0]?.cid === cid) return entries;
  const next = [{ cid, at: now, chars }, ...entries];
  return next.length > cap ? next.slice(0, cap) : next;
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
 * most recently recorded version (see addHistoryEntry). Also prunes any
 * note ids no longer present in mistlib's note index, so the history store
 * doesn't grow forever off notes that were deleted before this module
 * existed or through a path that didn't call clearHistory.
 */
export function recordVersion(noteId: string, cid: string, chars: number): void {
  const map = loadHistoryMap();
  const entries = addHistoryEntry(map[noteId] ?? [], cid, chars);
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

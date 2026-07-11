// Best-effort publisher that makes every note written in tc-note also show up
// in tc-storage (the sibling app at the same origin, see
// C:\Projects\tik-choco\tc-storage), via the shared bus rather than by
// writing tc-storage's own localStorage keys directly. See
// protocol/docs/data-contracts/docs/SHARED_BUS.md for the shared-bus contract
// and the `note-doc-index` topic in particular.
//
// Contract (fixed): unlike storageDriveInbox.ts's dropped files, note bodies
// need no fresh encryption here — saveNote (mistlib.ts) already uploads each
// note's markdown as plaintext bytes via mistlib's storage_add, so the CID
// already points at plaintext sitting in the shared mistlib OPFS block store.
// Publishing that CID alongside the note's id/title/updatedAt therefore adds
// no new exposure; it just tells tc-storage where to look. We republish the
// full (capped) index wholesale via publishShared("note-doc-index", "", {
// notes }) every time — mirroring how storage-drive-inbox and
// tc-translate's translations-inbox topic republish their full item lists —
// so tc-storage can pick up the current state even if it was closed when any
// individual note changed. Deletion is NOT propagated in v1: a deleted note
// simply drops out of the next published index; tc-storage keeps whatever
// copy it already imported.
//
// Best-effort: every failure is swallowed (after a console.warn), so this
// side channel can never break note saving/deleting/restoring itself.
import { listNotes, type NoteMeta } from "./mistlib";
import { publishShared } from "./sharedBus";

const TOPIC = "note-doc-index";
const MAX_NOTE_DOC_INDEX_ITEMS = 500;
const DEBOUNCE_MS = 1000;

/** One note entry in the `note-doc-index` topic's `meta.notes` list. */
export interface NoteDocIndexEntry {
  id: string;
  title: string;
  /** mistlib storage_add CID of the note's markdown bytes (plaintext). */
  cid: string;
  updatedAt: number;
}

/**
 * Builds the `note-doc-index` entry list from the full local note index:
 * drops notes with no cid yet (never saved), sorts by most-recently-updated
 * first, and caps at the MAX_NOTE_DOC_INDEX_ITEMS most recent so the record
 * doesn't grow unbounded as a note-taking history accumulates.
 */
export function buildNoteDocIndexEntries(notes: NoteMeta[]): NoteDocIndexEntry[] {
  return notes
    .filter((n): n is NoteMeta & { cid: string } => n.cid !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_NOTE_DOC_INDEX_ITEMS)
    .map((n) => ({ id: n.id, title: n.title, cid: n.cid, updatedAt: n.updatedAt }));
}

/**
 * Reads the current note index and republishes it wholesale onto the
 * `note-doc-index` shared-bus topic. Best effort: any failure (e.g.
 * localStorage disabled/full) is caught and warned, never thrown, so this
 * side channel can't break the caller's save/delete/restore flow.
 */
export function publishNoteDocIndex(): void {
  try {
    const entries = buildNoteDocIndexEntries(listNotes());
    publishShared(TOPIC, "", { notes: entries });
  } catch (error) {
    console.warn("tc-note note-doc-index publish failed", error);
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Trailing-debounced wrapper around `publishNoteDocIndex` (~1s): coalesces
 * bursts of saves/deletes/restores (e.g. autoImport batches, rapid autosave)
 * into a single republish instead of one per note.
 */
export function schedulePublishNoteDocIndex(): void {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    publishNoteDocIndex();
  }, DEBOUNCE_MS);
}

export { TOPIC as noteDocIndexTopic };

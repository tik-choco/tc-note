// Full backup export/import for the note index.
//
// tc-note's note list is a localStorage index (id -> title/cid/updatedAt/
// folderId, see mistlib.ts) that maps to mistlib's content-addressed CIDs.
// mistlib holds the bytes, but the index is the *only* thing that knows
// those CIDs exist -- clear the browser's site data (or just this origin's
// localStorage) and every note becomes unreachable garbage, even though the
// underlying mistlib store might still technically have the bytes somewhere.
//
// This module is the escape hatch: buildBackup() walks the index and
// resolves every note's full Markdown body (via loadNote, i.e. through
// mistlib) into one self-describing JSON object that has no dependency on
// mistlib's CIDs at all -- it can be restored into a completely fresh
// mistlib store. parseBackup() is the trust boundary for re-importing an
// arbitrary file a user picked off disk, so it is written defensively and
// never throws. applyBackup() writes the parsed backup back in through
// mistlib's existing public API (saveNote/setNoteFolder/createFolder) and is
// deliberately never destructive: importing can only add notes/folders, never
// overwrite or delete anything already present.
import {
  createFolder,
  listFolders,
  listNotes,
  loadNote,
  saveNote,
  setNoteFolder,
  toggleFavorite,
  type Folder,
  type NoteMeta,
} from "./mistlib";
import { newId } from "./util";

export const BACKUP_SCHEMA = "tc-note-backup";
export const BACKUP_VERSION = 1;

export interface BackupFolder {
  id: string;
  name: string;
  /** null = top-level folder */
  parentId: string | null;
}

export interface BackupNote {
  id: string;
  title: string;
  /** Full Markdown body -- the whole point is this has no CID dependency. */
  markdown: string;
  folderId: string | null;
  favorite: boolean;
  updatedAt: number;
}

export interface NoteBackup {
  schema: typeof BACKUP_SCHEMA;
  version: typeof BACKUP_VERSION;
  /** ISO 8601 timestamp of when the backup was built. */
  exportedAt: string;
  folders: BackupFolder[];
  notes: BackupNote[];
}

// ---------------------------------------------------------------------------
// buildBackup
// ---------------------------------------------------------------------------

// Walks every note and folder currently in the local index and resolves each
// note's full body through mistlib (loadNote), producing a single
// self-contained snapshot. Sequential awaits (not Promise.all) to avoid
// hammering mistNode with a burst of concurrent storage_get calls on a
// large note collection.
export async function buildBackup(): Promise<NoteBackup> {
  const notes: BackupNote[] = [];
  for (const meta of listNotes()) {
    const markdown = await loadNote(meta.id);
    notes.push({
      id: meta.id,
      title: meta.title,
      markdown,
      folderId: meta.folderId,
      favorite: meta.favorite,
      updatedAt: meta.updatedAt,
    });
  }

  const folders: BackupFolder[] = listFolders().map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
  }));

  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    folders,
    notes,
  };
}

// ---------------------------------------------------------------------------
// parseBackup
// ---------------------------------------------------------------------------

export type ParseBackupResult = { ok: true; backup: NoteBackup } | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseBackupFolder(raw: unknown, index: number): BackupFolder | { error: string } {
  if (!isPlainObject(raw)) return { error: `folders[${index}] is not an object` };
  if (typeof raw.id !== "string" || raw.id.length === 0) return { error: `folders[${index}].id is not a string` };
  if (typeof raw.name !== "string") return { error: `folders[${index}].name is not a string` };
  if (raw.parentId !== null && typeof raw.parentId !== "string") {
    return { error: `folders[${index}].parentId is not a string or null` };
  }
  return { id: raw.id, name: raw.name, parentId: raw.parentId };
}

function parseBackupNote(raw: unknown, index: number): BackupNote | { error: string } {
  if (!isPlainObject(raw)) return { error: `notes[${index}] is not an object` };
  if (typeof raw.id !== "string" || raw.id.length === 0) return { error: `notes[${index}].id is not a string` };
  if (typeof raw.title !== "string") return { error: `notes[${index}].title is not a string` };
  if (typeof raw.markdown !== "string") return { error: `notes[${index}].markdown is not a string` };
  if (raw.folderId !== null && typeof raw.folderId !== "string") {
    return { error: `notes[${index}].folderId is not a string or null` };
  }
  if (typeof raw.favorite !== "boolean") return { error: `notes[${index}].favorite is not a boolean` };
  if (typeof raw.updatedAt !== "number" || !Number.isFinite(raw.updatedAt)) {
    return { error: `notes[${index}].updatedAt is not a number` };
  }
  return {
    id: raw.id,
    title: raw.title,
    markdown: raw.markdown,
    folderId: raw.folderId,
    favorite: raw.favorite,
    updatedAt: raw.updatedAt,
  };
}

// Validates and parses an arbitrary string as a tc-note backup file. This is
// the trust boundary for a file the user picked off disk, so it is written
// defensively: no matter what `text` contains (empty string, non-JSON,
// a JSON array, a JSON object missing/mistyping every field, ...) this
// function returns a `{ ok: false, reason }` result instead of throwing, and
// `reason` is meant to be useful on its own (surfaced to the user or logged).
export function parseBackup(text: string): ParseBackupResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }

  if (!isPlainObject(data)) {
    return { ok: false, reason: "backup is not a JSON object" };
  }

  if (data.schema !== BACKUP_SCHEMA) {
    return { ok: false, reason: `unrecognized schema "${String(data.schema)}" (expected "${BACKUP_SCHEMA}")` };
  }
  if (data.version !== BACKUP_VERSION) {
    return { ok: false, reason: `unsupported backup version ${String(data.version)} (expected ${BACKUP_VERSION})` };
  }
  if (typeof data.exportedAt !== "string") {
    return { ok: false, reason: "missing exportedAt" };
  }
  if (!Array.isArray(data.folders)) {
    return { ok: false, reason: "missing folders array" };
  }
  if (!Array.isArray(data.notes)) {
    return { ok: false, reason: "missing notes array" };
  }

  const folders: BackupFolder[] = [];
  for (let i = 0; i < data.folders.length; i++) {
    const parsed = parseBackupFolder(data.folders[i], i);
    if ("error" in parsed) return { ok: false, reason: parsed.error };
    folders.push(parsed);
  }

  const notes: BackupNote[] = [];
  for (let i = 0; i < data.notes.length; i++) {
    const parsed = parseBackupNote(data.notes[i], i);
    if ("error" in parsed) return { ok: false, reason: parsed.error };
    notes.push(parsed);
  }

  return {
    ok: true,
    backup: { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, exportedAt: data.exportedAt, folders, notes },
  };
}

// ---------------------------------------------------------------------------
// applyBackup -- pure planning + impure execution
// ---------------------------------------------------------------------------
//
// The decision logic (which folders already exist vs. need creating, which
// notes collide with an existing id) is factored into pure functions
// (planFolderImport / planNoteImport) that take plain data in and return a
// plan out, with no localStorage/mistlib/browser dependency at all -- so it
// can be unit tested directly. applyBackup() just executes that plan through
// mistlib's public API.

export type FolderPlanAction =
  | { backupId: string; action: "reuse"; localId: string }
  | { backupId: string; action: "create"; name: string; parentBackupId: string | null };

// Decides, for every folder in the backup, whether it matches an existing
// local folder (same name + same *resolved* parent) or needs to be created.
// Returns the plan in an order safe to execute sequentially top-down: a
// folder's entry always comes after its parent's, so by the time a "create"
// step runs, its parent (if also newly created) has already been created and
// its real local id is known.
//
// Folders are matched by name+parent, walking up each folder's own ancestor
// chain within the backup (not just its immediate parent) so a whole
// pre-existing subtree is recognized and reused rather than partially
// duplicated. Malformed references tolerate gracefully rather than throwing:
// a parentId that doesn't correspond to any folder in this backup, or a
// parent cycle, is treated as "no parent" (top-level) for that folder.
export function planFolderImport(backupFolders: BackupFolder[], existingFolders: Folder[]): FolderPlanAction[] {
  const byId = new Map(backupFolders.map((f) => [f.id, f]));
  const plan = new Map<string, FolderPlanAction>();
  const visiting = new Set<string>();

  function resolve(backupId: string): FolderPlanAction {
    const cached = plan.get(backupId);
    if (cached) return cached;

    const bf = byId.get(backupId);
    // Not expected to happen (resolve is only ever called with ids drawn
    // from backupFolders itself), but stay defensive rather than crashing.
    if (!bf) {
      const action: FolderPlanAction = { backupId, action: "create", name: "", parentBackupId: null };
      plan.set(backupId, action);
      return action;
    }

    // Dangling parent reference (points at a folder id absent from this
    // backup) or a parent cycle: treat as top-level rather than failing.
    let parentBackupId = bf.parentId;
    if (parentBackupId !== null && (!byId.has(parentBackupId) || visiting.has(parentBackupId))) {
      parentBackupId = null;
    }

    let parentIsPending = false;
    let resolvedParentLocalId: string | null = null;
    if (parentBackupId !== null) {
      visiting.add(backupId);
      const parentAction = resolve(parentBackupId);
      visiting.delete(backupId);
      if (parentAction.action === "reuse") {
        resolvedParentLocalId = parentAction.localId;
      } else {
        parentIsPending = true;
      }
    }

    let action: FolderPlanAction;
    // If the parent is itself a pending "create", no existing folder can
    // possibly already sit under it, so skip the matching search entirely.
    const match = parentIsPending
      ? undefined
      : existingFolders.find((f) => f.name === bf.name && f.parentId === resolvedParentLocalId);
    if (match) {
      action = { backupId, action: "reuse", localId: match.id };
    } else {
      action = { backupId, action: "create", name: bf.name, parentBackupId };
    }

    plan.set(backupId, action);
    return action;
  }

  for (const f of backupFolders) resolve(f.id);
  return Array.from(plan.values());
}

export interface NotePlanEntry {
  backupId: string;
  /** id to save the note under -- either the original id, or a fresh one on collision. */
  targetId: string;
  /** true when targetId differs from backupId because backupId already exists locally. */
  collided: boolean;
  title: string;
  markdown: string;
  favorite: boolean;
  folderBackupId: string | null;
}

// Decides, for every note in the backup, whether its original id is free to
// reuse or collides with a note that already exists locally (in which case
// it's imported under a freshly generated id instead -- an import must never
// be able to overwrite/destroy a note that's already there). Also guards
// against two notes *within the same backup* sharing an id (a malformed or
// hand-edited file), which would otherwise silently collide with each other.
export function planNoteImport(backupNotes: BackupNote[], existingNotes: NoteMeta[]): NotePlanEntry[] {
  const usedIds = new Set(existingNotes.map((n) => n.id));

  return backupNotes.map((n) => {
    const collided = usedIds.has(n.id);
    const targetId = collided ? newId() : n.id;
    usedIds.add(targetId);
    return {
      backupId: n.id,
      targetId,
      collided,
      title: n.title,
      markdown: n.markdown,
      favorite: n.favorite,
      folderBackupId: n.folderId,
    };
  });
}

export interface BackupApplySummary {
  notesImported: number;
  notesSkipped: number;
  foldersCreated: number;
}

// Writes a validated backup back in through mistlib's existing public API.
// Never destructive: folders are only ever matched-or-created (never
// renamed/merged into something that already differs), and notes whose id
// collides with an existing note are imported under a fresh id (see
// planNoteImport) rather than overwriting it. A single note failing to save
// (e.g. a transient storage error) is logged and counted as skipped rather
// than aborting the whole import.
export async function applyBackup(backup: NoteBackup): Promise<BackupApplySummary> {
  const folderPlan = planFolderImport(backup.folders, listFolders());

  const localIdByBackupId = new Map<string, string>();
  let foldersCreated = 0;
  for (const step of folderPlan) {
    if (step.action === "reuse") {
      localIdByBackupId.set(step.backupId, step.localId);
    } else {
      const parentLocalId = step.parentBackupId === null ? null : (localIdByBackupId.get(step.parentBackupId) ?? null);
      const created = createFolder(step.name, parentLocalId);
      localIdByBackupId.set(step.backupId, created.id);
      foldersCreated++;
    }
  }

  const notePlan = planNoteImport(backup.notes, listNotes());

  let notesImported = 0;
  let notesSkipped = 0;
  for (const step of notePlan) {
    try {
      await saveNote(step.targetId, step.title, step.markdown);
      const folderLocalId = step.folderBackupId === null ? null : (localIdByBackupId.get(step.folderBackupId) ?? null);
      if (folderLocalId !== null) setNoteFolder(step.targetId, folderLocalId);
      if (step.favorite) toggleFavorite(step.targetId);
      notesImported++;
    } catch (error) {
      console.error(`noteBackup: failed to import note "${step.backupId}"`, error);
      notesSkipped++;
    }
  }

  return { notesImported, notesSkipped, foldersCreated };
}

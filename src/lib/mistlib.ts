// Thin wrapper around the vendored mistlib-wasm build (see
// scripts/fetch-mistlib.mjs). Provides note persistence backed by
// mistlib's content-addressed P2P storage (storage_add / storage_get).
//
// mistlib is content-addressed only — it has no concept of a note "list",
// "id", or folder, just CIDs. So we keep a small local index (id ->
// title/cid/updatedAt/folderId) and a folder list in localStorage, and use
// mistlib purely as the durable byte store.

import { storage_add, storage_get } from "../vendor/mistlib/wrappers/web/index.js";
import { ensureMistNode } from "./mistNode";
import { clearHistory, recordVersion } from "./noteHistory";

const INDEX_KEY = "tc-note:index";
const FOLDERS_KEY = "tc-note:folders";

export interface NoteMeta {
  id: string;
  title: string;
  cid: string | null;
  updatedAt: number;
  favorite: boolean;
  /** short plain-text snippet of the note body, kept for list display + search */
  preview: string;
  /** null = unfiled (no folder) */
  folderId: string | null;
}

export interface Folder {
  id: string;
  name: string;
  /** null = top-level folder */
  parentId: string | null;
  /**
   * Base id for the collab rooms every note in this folder joins (each note
   * derives its own room from it — see deriveNoteRoomId); unset/null = not
   * shared.
   */
  roomId?: string | null;
}

/**
 * How a note is shared, as the sidebar shows it:
 *   - "live"   — the session is connected to this note's room right now.
 *   - "manual" — the user shared this note explicitly (share button, invite
 *                link, join-by-id) but isn't connected to it at the moment.
 *   - "folder" — the note sits in a shared folder, so opening it starts
 *                collaborating even though the note itself was never shared.
 *   - "local"  — not shared at all.
 * Ranked, not a set: a note can qualify for several at once and the most
 * specific one wins, so a row never has to show two markers.
 */
export type NoteShareState = "live" | "manual" | "folder" | "local";

export function noteShareState(
  note: Pick<NoteMeta, "id" | "folderId">,
  folders: Folder[],
  manuallySharedNoteIds: ReadonlySet<string>,
  connectedNoteId: string | null,
): NoteShareState {
  if (connectedNoteId === note.id) return "live";
  if (manuallySharedNoteIds.has(note.id)) return "manual";
  const folder = note.folderId ? folders.find((f) => f.id === note.folderId) : undefined;
  if (folder?.roomId) return "folder";
  return "local";
}

function loadIndex(): NoteMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const notes = JSON.parse(raw) as NoteMeta[];
    // tolerate notes saved before folders existed
    return notes.map((n) => ({ ...n, folderId: n.folderId ?? null }));
  } catch {
    return [];
  }
}

function saveIndex(index: NoteMeta[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

function loadFolders(): Folder[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    return raw ? (JSON.parse(raw) as Folder[]) : [];
  } catch {
    return [];
  }
}

function saveFolders(folders: Folder[]) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

// Strips common Markdown syntax down to plain text, collapses whitespace, and
// truncates to `maxLength`. Shared by the note-list preview (120 chars) and
// the note-article share excerpt (see shareArticle.ts, 200 chars) so both
// stay visually consistent without duplicating the regex pipeline.
export function markdownToPlainText(markdown: string, maxLength: number): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images -> alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> link text
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/gm, "") // list markers / checkboxes
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/[*_]([^*_]+)[*_]/g, "$1") // italic
    .replace(/^-{3,}$/gm, " "); // horizontal rules
  return plain.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function makePreview(markdown: string): string {
  return markdownToPlainText(markdown, 120);
}

export function listNotes(): NoteMeta[] {
  return loadIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveNote(id: string, title: string, markdown: string): Promise<NoteMeta> {
  await ensureMistNode();
  const data = new TextEncoder().encode(markdown);
  const cid = await storage_add(`${id}.md`, data);

  const index = loadIndex();
  const existingIdx = index.findIndex((n) => n.id === id);
  const meta: NoteMeta = {
    id,
    title,
    cid,
    updatedAt: Date.now(),
    favorite: existingIdx >= 0 ? index[existingIdx].favorite : false,
    folderId: existingIdx >= 0 ? index[existingIdx].folderId : null,
    preview: makePreview(markdown),
  };
  if (existingIdx >= 0) {
    index[existingIdx] = meta;
  } else {
    index.push(meta);
  }
  saveIndex(index);
  // Every storage_add above already wrote an immutable, content-addressed
  // blob — recordVersion just keeps a pointer to it so it stays reachable
  // (see noteHistory.ts). Best-effort: a failure here must never break the
  // save itself.
  try {
    recordVersion(id, cid, markdown.length);
  } catch (err) {
    console.warn("mistlib: failed to record version history", err);
  }
  return meta;
}

export async function loadNote(id: string): Promise<string> {
  const index = loadIndex();
  const meta = index.find((n) => n.id === id);
  if (!meta?.cid) return "";

  await ensureMistNode();
  const bytes: Uint8Array = await storage_get(meta.cid);
  return new TextDecoder().decode(bytes);
}

export function deleteNote(id: string) {
  saveIndex(loadIndex().filter((n) => n.id !== id));
  try {
    clearHistory(id);
  } catch (err) {
    console.warn("mistlib: failed to clear version history", err);
  }
}

// Re-inserts a previously deleted note (used by the undo toast). The blob
// itself was never removed from mistlib's content-addressed store — only
// the local index entry was — so restoring just needs the old metadata back.
export function restoreNote(meta: NoteMeta) {
  const index = loadIndex();
  if (index.some((n) => n.id === meta.id)) return;
  index.push(meta);
  saveIndex(index);
}

export function toggleFavorite(id: string): NoteMeta[] {
  const index = loadIndex();
  const meta = index.find((n) => n.id === id);
  if (meta) meta.favorite = !meta.favorite;
  saveIndex(index);
  return index;
}

// Explicit set rather than toggle — a bulk "favorite these 5 notes" action
// has to drive every note to the *same* state, which repeated toggles can't do
// when the selection is mixed.
export function setNoteFavorite(id: string, favorite: boolean): NoteMeta[] {
  const index = loadIndex();
  const meta = index.find((n) => n.id === id);
  if (meta) meta.favorite = favorite;
  saveIndex(index);
  return index;
}

export function setNoteFolder(id: string, folderId: string | null): NoteMeta[] {
  const index = loadIndex();
  const meta = index.find((n) => n.id === id);
  if (meta) meta.folderId = folderId;
  saveIndex(index);
  return index;
}

export function listFolders(): Folder[] {
  return loadFolders().sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export function createFolder(name: string, parentId: string | null = null): Folder {
  const folders = loadFolders();
  const folder: Folder = { id: crypto.randomUUID(), name, parentId };
  folders.push(folder);
  saveFolders(folders);
  return folder;
}

export function renameFolder(id: string, name: string): Folder[] {
  const folders = loadFolders();
  const folder = folders.find((f) => f.id === id);
  if (folder) folder.name = name;
  saveFolders(folders);
  return folders;
}

// Assigns (or clears, with roomId = null) the collab room every note in this
// folder auto-joins. See useCollab's folder-driven auto-join effect.
export function setFolderRoom(id: string, roomId: string | null): Folder[] {
  const folders = loadFolders();
  const folder = folders.find((f) => f.id === id);
  if (folder) folder.roomId = roomId;
  saveFolders(folders);
  return folders;
}

// Deleting a folder does not delete its notes or subfolders — they're
// reparented to the root so nothing is silently lost.
export function deleteFolder(id: string): { folders: Folder[]; notes: NoteMeta[] } {
  const folders = loadFolders()
    .filter((f) => f.id !== id)
    .map((f) => (f.parentId === id ? { ...f, parentId: null } : f));
  saveFolders(folders);

  const index = loadIndex().map((n) => (n.folderId === id ? { ...n, folderId: null } : n));
  saveIndex(index);

  return { folders, notes: index };
}

// Re-inserts a previously deleted folder (used by the undo toast). Note
// re-assignment back into it is the caller's responsibility, since this
// module only tracks folders/notes independently.
export function restoreFolder(folder: Folder) {
  const folders = loadFolders();
  if (folders.some((f) => f.id === folder.id)) return;
  folders.push(folder);
  saveFolders(folders);
}

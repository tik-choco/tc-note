// Consumes the shared `note-inbox` topic (published by tc-storage on the
// same origin when the user clicks "open in tc-note" on a text file
// preview) and imports each new file as a note, filed into a dedicated
// "tc-storageから追加" folder — mirroring tc-storage's own appDriveInbox.ts,
// the reverse-direction consumer for this app's storage-drive-inbox topic
// (storageDriveInbox.ts).
//
// Each item's bytes live behind mistlib's storage_get, encrypted client-side
// by tc-storage with a fresh AES-256-GCM key carried alongside the CID in
// the item itself (same-origin localStorage is the trust boundary for this
// bus, same as everywhere else — see protocol/docs/data-contracts/docs/
// SHARED_BUS.md). This module resolves the ciphertext, decrypts it, and
// verifies the SHA-256 checksum before decoding it as UTF-8 text and saving
// it as a note via mistlib's own saveNote/setNoteFolder (the same
// note-creation path used by importDocument.ts and autoImport.ts) — it
// never touches note storage directly.
//
// Items are deduped by their stable `id` (persisted in localStorage), so a
// republished list never creates duplicates and user deletions are
// respected. Items that fail to decrypt/verify, or aren't text-like, are
// unrecoverable/not-applicable, so they're marked imported too rather than
// retried forever on every republish. Items that fail to *resolve* for a
// transient reason (the mistlib module failed to load, or storage_get
// itself failed — e.g. a network hiccup or the block simply isn't
// replicated yet) are a different story: retrying can succeed later, so
// those ids are deliberately left out of the imported set and get another
// attempt on the next republish/subscription tick or mount. A note-creation
// failure (saveNote/setNoteFolder throwing) is treated the same way, since
// it's typically a transient storage/mistlib issue rather than something
// about the item itself.
//
// Contract: topic `note-inbox` (v1); item shape is published by tc-storage
// (src/storage/fileHandoff.ts). See protocol/docs/data-contracts/docs/
// SHARED_BUS.md.

import { saveNote, setNoteFolder, listFolders, createFolder, type NoteMeta } from "./mistlib";
import { newId } from "./util";
import { ensureMistNode } from "./mistNode";
import { storage_get } from "../vendor/mistlib/wrappers/web/index.js";
import type { SharedRecord } from "./sharedBus";

export const noteInboxTopic = "note-inbox";

const importedIdsKey = "tc-note-inbox-imported-v1";
const maxImportedIds = 1000;
const inboxFolderName = "tc-storageから追加";

/** One file entry in the `note-inbox` topic's `meta.items` list. Mirrors
 * tc-storage's FileHandoffItem (src/storage/fileHandoff.ts). */
export interface FileHandoffItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** SHA-256 hex digest of the plaintext bytes. */
  checksum: string;
  /** mistlib storage_add CID of the AES-GCM-encrypted bytes. */
  cid: string;
  /** Base64 raw AES-256-GCM key material. */
  key: string;
  /** Base64 96-bit AES-GCM IV. */
  iv: string;
  addedAt: string;
}

/** Parses the current topic record's items, tolerating malformed/missing meta. */
export function parseHandoffItems(meta: Record<string, unknown> | undefined): FileHandoffItem[] {
  const rawItems = meta ? (meta as { items?: unknown }).items : undefined;
  if (!Array.isArray(rawItems)) return [];
  const items: FileHandoffItem[] = [];
  for (const raw of rawItems) {
    if (raw === null || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (
      typeof item.id === "string" && item.id &&
      typeof item.name === "string" &&
      typeof item.mimeType === "string" &&
      typeof item.size === "number" &&
      typeof item.checksum === "string" &&
      typeof item.cid === "string" &&
      typeof item.key === "string" &&
      typeof item.iv === "string" &&
      typeof item.addedAt === "string"
    ) {
      items.push({
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size,
        checksum: item.checksum,
        cid: item.cid,
        key: item.key,
        iv: item.iv,
        addedAt: item.addedAt,
      });
    }
  }
  return items;
}

// Some OSes/browsers report application/octet-stream (or leave mimeType
// empty) for common text formats, so filename extension is checked too.
const TEXT_LIKE_EXTENSIONS = [
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".json",
  ".csv",
  ".tsv",
  ".log",
  ".yml",
  ".yaml",
  ".xml",
];

/** Whether `item` looks like plaintext worth importing as a note body. */
export function isTextLikeItem(item: Pick<FileHandoffItem, "name" | "mimeType">): boolean {
  if (item.mimeType.toLowerCase().startsWith("text/")) return true;
  const lower = item.name.toLowerCase();
  return TEXT_LIKE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Strips a trailing filename extension (if any) for use as a note title. */
export function titleFromFileName(name: string): string {
  const stripped = name.replace(/\.[^./\\]+$/, "").trim();
  return stripped || name.trim() || "Untitled";
}

/** Reads the persisted set of already-imported item ids, tolerating missing/malformed storage. */
export function loadImportedIds(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(importedIdsKey) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/** Persists `ids`, keeping only the most recent maxImportedIds entries so the set can't grow unbounded. */
export function saveImportedIds(ids: Set<string>): void {
  const list = [...ids].slice(-maxImportedIds);
  try {
    localStorage.setItem(importedIdsKey, JSON.stringify(list));
  } catch (error) {
    console.warn("note-inbox: failed to persist imported ids", error);
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Outcome of resolving one item: usable text, a permanent (unrecoverable/not-applicable) skip, or a transient failure worth retrying later. */
export type ResolveItemResult =
  | { kind: "resolved"; name: string; text: string }
  | { kind: "permanent" }
  | { kind: "transient" };

/** Fetches, decrypts, and checksum-verifies one item's ciphertext, decoding it as UTF-8 text. Non-text-like items are skipped (permanent) without ever touching storage_get. */
async function resolveItemText(item: FileHandoffItem): Promise<ResolveItemResult> {
  if (!isTextLikeItem(item)) {
    console.warn("note-inbox: skipping non-text item", { id: item.id, name: item.name, mimeType: item.mimeType });
    return { kind: "permanent" };
  }

  let cipherText: Uint8Array;
  try {
    await ensureMistNode();
    cipherText = await storage_get(item.cid);
  } catch (error) {
    console.warn("note-inbox: transient failure resolving item; will retry later", { id: item.id, name: item.name, error });
    return { kind: "transient" };
  }

  try {
    const cryptoKey = await crypto.subtle.importKey("raw", base64ToBytes(item.key) as BufferSource, "AES-GCM", false, ["decrypt"]);
    const iv = base64ToBytes(item.iv);
    const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, cryptoKey, cipherText as BufferSource);
    const plainBytes = new Uint8Array(plainBuffer);
    const checksum = await sha256Hex(plainBytes);
    if (checksum !== item.checksum) {
      console.warn("note-inbox: checksum mismatch, skipping item", { id: item.id, name: item.name });
      return { kind: "permanent" };
    }
    return { kind: "resolved", name: item.name, text: new TextDecoder().decode(plainBytes) };
  } catch (error) {
    console.warn("note-inbox: failed to decrypt item, skipping", { id: item.id, name: item.name, error });
    return { kind: "permanent" };
  }
}

export interface NoteInboxOptions {
  /** Overridable for tests; defaults to the real mistlib-backed resolver. */
  resolveItem?: (item: FileHandoffItem) => Promise<ResolveItemResult>;
}

export interface NoteInboxActions {
  /** Imports any not-yet-seen items from an inbox record. Safe to call repeatedly. */
  importFromInbox(record: SharedRecord): void;
}

/**
 * Creates note-inbox import actions. `onImported` is called (with the newly
 * created notes, oldest to newest) after a run that created at least one
 * note. Mirrors tc-storage's appDriveInbox.ts (createDriveInboxActions):
 * the same idempotency approach and temporary-vs-permanent failure split —
 * see the module doc above.
 */
export function createNoteInboxActions(
  onImported: (notes: NoteMeta[]) => void,
  options: NoteInboxOptions = {},
): NoteInboxActions {
  const { resolveItem = resolveItemText } = options;
  // Serialize imports: several bus channels can fire for one update, and
  // storage_get/saveNote are async, so we must not process the same items
  // concurrently.
  let inFlight: Promise<void> = Promise.resolve();

  function ensureInboxFolderId(): string {
    const existing = listFolders().find((folder) => folder.parentId === null && folder.name === inboxFolderName);
    if (existing) return existing.id;
    return createFolder(inboxFolderName).id;
  }

  async function runImport(record: SharedRecord): Promise<void> {
    const items = parseHandoffItems(record.meta);
    if (!items.length) return;
    const imported = loadImportedIds();
    const fresh = items.filter((item) => !imported.has(item.id));
    if (!fresh.length) return;

    const created: NoteMeta[] = [];
    let folderId: string | null = null;
    for (const item of fresh) {
      const result = await resolveItem(item);
      if (result.kind === "resolved") {
        try {
          if (folderId === null) folderId = ensureInboxFolderId();
          const meta = await saveNote(newId(), titleFromFileName(result.name), result.text);
          setNoteFolder(meta.id, folderId);
          created.push({ ...meta, folderId });
          imported.add(item.id);
        } catch (error) {
          // Leave this id out of `imported` so the next republish/
          // subscription tick or mount retries the note creation.
          console.warn("note-inbox: failed to create note; will retry later", { id: item.id, name: item.name, error });
        }
      } else if (result.kind === "permanent") {
        imported.add(item.id);
      }
      // 'transient': leave out of `imported` entirely.
    }

    saveImportedIds(imported);
    if (created.length > 0) onImported(created);
  }

  function importFromInbox(record: SharedRecord): void {
    inFlight = inFlight.then(() => runImport(record)).catch(() => {});
  }

  return { importFromInbox };
}

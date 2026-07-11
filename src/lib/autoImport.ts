// Automatic import of content from sibling same-origin tik-choco apps: PDF
// documents (OCR content/summary/translations) from tc-pdf-viewer, and
// translation history from tc-translate. Runs a scan on start, then
// re-scans whenever either source signals new content. Each importable item
// has a stable idempotency key so a scan never imports the same item twice
// — including after the user deletes the resulting note, which is the whole
// point: deletions must not resurrect auto-imported notes.
import { createFolder, listFolders, listNotes, saveNote, setNoteFolder } from "./mistlib";
import { newId } from "./util";
import { ensureMistNode } from "./mistNode";
import { listPdfViewerDocumentParts, subscribePdfViewerDocumentsChanged } from "./importDocument";
import {
  HISTORY_KEY as TRANSLATION_HISTORY_KEY,
  readHistory,
  translationNoteId,
  translationNoteTitle,
  translationNoteMarkdown,
  ensureTranslationFolder,
} from "./importTranslations";

const STORE_KEY = "tc-note-auto-imported-v1";
const STORE_CAP = 2000;
const PDF_FOLDER_NAME = "PDF資料";

interface AutoImportStore {
  v: 1;
  keys: string[];
}

function emptyStore(): AutoImportStore {
  return { v: 1, keys: [] };
}

function loadStore(): AutoImportStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyStore();
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return emptyStore();
    const keys = (parsed as { keys?: unknown }).keys;
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string")) return emptyStore();
    // Defensive cap in case the stored file was ever hand-edited or written
    // by a future format that didn't enforce the cap itself.
    const capped = keys.length > STORE_CAP ? keys.slice(keys.length - STORE_CAP) : keys;
    return { v: 1, keys: capped };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: AutoImportStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (error) {
    console.warn("autoImport: failed to persist import store", error);
  }
}

// Adds `key` to both the in-memory dedup set and the persisted store,
// re-saving immediately (per item, not batched) so a crash mid-scan can't
// re-import items already completed before it.
function recordKey(store: AutoImportStore, keySet: Set<string>, key: string): void {
  if (keySet.has(key)) return;
  keySet.add(key);
  store.keys.push(key);
  while (store.keys.length > STORE_CAP) {
    const dropped = store.keys.shift();
    if (dropped !== undefined) keySet.delete(dropped);
  }
  saveStore(store);
}

function ensurePdfFolder(): string {
  const existing = listFolders().find((f) => f.name === PDF_FOLDER_NAME);
  if (existing) return existing.id;
  return createFolder(PDF_FOLDER_NAME).id;
}

// Runs one full scan (PDF parts, then translation history) and returns the
// number of notes newly created. Never throws: per-item failures are caught,
// logged, and skipped so one bad item can't abort the rest of the scan.
async function scanOnce(): Promise<number> {
  await ensureMistNode();

  const store = loadStore();
  const keySet = new Set(store.keys);
  let created = 0;

  let pdfFolderId: string | null = null;
  for (const part of listPdfViewerDocumentParts()) {
    if (keySet.has(part.key)) continue;
    try {
      if (pdfFolderId === null) pdfFolderId = ensurePdfFolder();
      const meta = await saveNote(newId(), part.title, part.content);
      setNoteFolder(meta.id, pdfFolderId);
      created++;
    } catch (error) {
      console.warn(`autoImport: failed to import pdf part "${part.key}"`, error);
      continue;
    }
    recordKey(store, keySet, part.key);
  }

  const history = readHistory();
  if (history.length > 0) {
    const existingNoteIds = new Set(listNotes().map((n) => n.id));
    let translationFolderId: string | null = null;
    for (const item of history) {
      const key = `tr:${item.id}`;
      if (keySet.has(key)) continue;
      const id = translationNoteId(item.id);
      try {
        if (existingNoteIds.has(id)) {
          // Already present from an earlier manual import — just record the
          // key so it isn't re-created, without duplicating the note.
        } else {
          if (translationFolderId === null) translationFolderId = ensureTranslationFolder();
          await saveNote(id, translationNoteTitle(item.sourceText), translationNoteMarkdown(item));
          setNoteFolder(id, translationFolderId);
          existingNoteIds.add(id);
          created++;
        }
      } catch (error) {
        console.warn(`autoImport: failed to import translation "${key}"`, error);
        continue;
      }
      recordKey(store, keySet, key);
    }
  }

  return created;
}

/**
 * Starts auto-import: runs one scan immediately, then re-scans on
 * tc-pdf-viewer OCR-index shared-bus notifications and on localStorage
 * `storage` events for the tc-translate history key. Calls
 * `onImported(newNoteCount)` after any scan that created more than 0 notes.
 * Returns a stop function that unsubscribes both triggers and prevents any
 * already-queued re-scan from starting (a scan already in flight when stop()
 * is called is allowed to finish, since aborting it mid-item would leave
 * mistlib writes half-applied).
 */
export function startAutoImport(onImported: (count: number) => void): () => void {
  let running = false;
  let queued = false;
  let stopped = false;

  function runScan(): void {
    if (stopped) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    scanOnce()
      .then((count) => {
        if (count > 0) onImported(count);
      })
      .catch((error) => {
        console.warn("autoImport: scan failed", error);
      })
      .finally(() => {
        running = false;
        if (queued && !stopped) {
          queued = false;
          runScan();
        }
      });
  }

  runScan();

  const unsubscribeBus = subscribePdfViewerDocumentsChanged(() => runScan());

  function onStorageEvent(event: StorageEvent): void {
    if (event.key !== TRANSLATION_HISTORY_KEY) return;
    runScan();
  }
  window.addEventListener("storage", onStorageEvent);

  return () => {
    stopped = true;
    queued = false;
    unsubscribeBus();
    window.removeEventListener("storage", onStorageEvent);
  };
}

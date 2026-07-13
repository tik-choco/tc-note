// Imports translation history from tc-translate, a sister app running on the
// same origin. tc-translate stores its history directly in localStorage
// (shared across same-origin apps), so it's read from there rather than via
// a file-based bundle format. Reuses mistlib's own note-creation path
// (saveNote/setNoteFolder/createFolder) rather than touching note storage
// directly.
//
// Dual-read (contract B, see storage-fix-spec / SHARED_BUS.md): older items
// inline every field. Newer items keep only a small preview (id, timestamp,
// mode, sourcePreview, targetLanguage, ...) plus a `bodyCid` pointing at the
// heavy fields (sourceText, translations, proofread, explain) content-
// addressed via mistlib's storage_add. readHistory() resolves both shapes
// transparently.
import { createFolder, listFolders, listNotes, saveNote, setNoteFolder } from "./mistlib";
import { storage_get } from "../vendor/mistlib/wrappers/web/index.js";
import { ensureMistNode } from "./mistNode";

// Exported so autoImport.ts's `storage` event listener can filter to this
// exact key without duplicating the literal.
export const HISTORY_KEY = "tc-translate-history-v1";
const FOLDER_NAME = "翻訳履歴";

interface TranslationVariant {
  tone: string;
  text: string;
  pinyin?: string;
  reading?: string;
}

export interface TranslationHistoryItem {
  id: string;
  createdAt: number;
  sourceText: string;
  targetLanguage: string;
  translations: TranslationVariant[];
}

export interface ImportTranslationsResult {
  imported: number;
  skipped: number;
}

function isTranslationVariant(value: unknown): value is TranslationVariant {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.tone !== "string" || typeof v.text !== "string") return false;
  if (v.pinyin !== undefined && typeof v.pinyin !== "string") return false;
  if (v.reading !== undefined && typeof v.reading !== "string") return false;
  return true;
}

function isTranslationHistoryItem(value: unknown): value is TranslationHistoryItem {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.createdAt !== "number") return false;
  if (typeof v.sourceText !== "string" || typeof v.targetLanguage !== "string") return false;
  if (!Array.isArray(v.translations) || !v.translations.every(isTranslationVariant)) return false;
  return true;
}

// Resolves one raw history entry read from HISTORY_KEY. Old-format entries
// (every field inline) pass through as-is; new-format entries (id + preview
// fields + bodyCid) are expanded by fetching the heavy fields from mistlib.
// Returns null for anything unrecognized/unresolvable so the caller can
// silently skip it (same tolerance as the old plain isTranslationHistoryItem
// filter).
async function resolveHistoryItem(value: unknown): Promise<TranslationHistoryItem | null> {
  if (isTranslationHistoryItem(value)) return value;

  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.bodyCid !== "string") return null;

  try {
    await ensureMistNode();
    const bytes = await storage_get(v.bodyCid);
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (body === null || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;

    const sourceText = typeof b.sourceText === "string" ? b.sourceText : typeof v.sourcePreview === "string" ? v.sourcePreview : "";
    const targetLanguage = typeof v.targetLanguage === "string" ? v.targetLanguage : typeof b.targetLanguage === "string" ? b.targetLanguage : "";
    const translations = Array.isArray(b.translations) && b.translations.every(isTranslationVariant) ? (b.translations as TranslationVariant[]) : [];
    const createdAt = typeof v.createdAt === "number" ? v.createdAt : typeof v.timestamp === "number" ? v.timestamp : 0;

    return { id: v.id, createdAt, sourceText, targetLanguage, translations };
  } catch (error) {
    console.warn(`importTranslations: failed to resolve bodyCid for history item "${v.id}"`, error);
    return null;
  }
}

export async function readHistory(): Promise<TranslationHistoryItem[]> {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items: TranslationHistoryItem[] = [];
    for (const value of parsed) {
      const resolved = await resolveHistoryItem(value);
      if (resolved) items.push(resolved);
    }
    return items;
  } catch {
    return [];
  }
}

export function translationNoteId(historyId: string): string {
  return `tc-translate:${historyId}`;
}

export function translationNoteTitle(sourceText: string): string {
  const trimmed = sourceText.trim().replace(/\s+/g, " ");
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed || "Untitled";
}

export function translationNoteMarkdown(item: TranslationHistoryItem): string {
  const lines: string[] = [];
  lines.push(`# ${translationNoteTitle(item.sourceText)}`, "");
  lines.push("## 原文", "", item.sourceText, "");
  lines.push(`## 訳文 (${item.targetLanguage})`, "");
  for (const variant of item.translations) {
    lines.push(`### ${variant.tone}`, "", variant.text);
    if (variant.pinyin) lines.push("", `拼音: ${variant.pinyin}`);
    if (variant.reading) lines.push("", `読み: ${variant.reading}`);
    lines.push("");
  }
  lines.push(`翻訳日時: ${new Date(item.createdAt).toLocaleString()}`);
  return lines.join("\n");
}

// Finds or creates the "翻訳履歴" folder notes get filed into. Exported so
// autoImport.ts's PDF-import path can use the analogous "PDF資料" pattern
// without duplicating the find-or-create logic, and so tests can assert
// against the same folder-name constant.
export function ensureTranslationFolder(): string {
  const existing = listFolders().find((f) => f.name === FOLDER_NAME);
  if (existing) return existing.id;
  return createFolder(FOLDER_NAME).id;
}

export async function importTranslationHistory(): Promise<ImportTranslationsResult> {
  const history = await readHistory();
  const existingIds = new Set(listNotes().map((n) => n.id));
  const folderId = ensureTranslationFolder();

  let imported = 0;
  let skipped = 0;

  for (const item of history) {
    const id = translationNoteId(item.id);
    if (existingIds.has(id)) {
      skipped++;
      continue;
    }
    await saveNote(id, translationNoteTitle(item.sourceText), translationNoteMarkdown(item));
    setNoteFolder(id, folderId);
    imported++;
  }

  return { imported, skipped };
}

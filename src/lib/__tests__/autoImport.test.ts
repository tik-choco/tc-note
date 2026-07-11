import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NoteMeta } from "../mistlib";
import type { PdfViewerDocumentPart } from "../importDocument";

// autoImport.ts only needs mistlib's note/folder-creation surface, mistNode's
// readiness gate, importDocument's fine-grained pdf-part listing + change
// notification, and importTranslations' history/id/title/markdown/folder
// helpers — so mock all four directly, matching importDocument.test.ts's
// style of mocking ../mistlib rather than the underlying wasm store.
const { saveNote, setNoteFolder, listFolders, createFolder, listNotes } = vi.hoisted(() => ({
  saveNote: vi.fn(),
  setNoteFolder: vi.fn(),
  listFolders: vi.fn(),
  createFolder: vi.fn(),
  listNotes: vi.fn(),
}));
vi.mock("../mistlib", () => ({ saveNote, setNoteFolder, listFolders, createFolder, listNotes }));

const { ensureMistNode } = vi.hoisted(() => ({ ensureMistNode: vi.fn() }));
vi.mock("../mistNode", () => ({ ensureMistNode }));

const { listPdfViewerDocumentParts, subscribePdfViewerDocumentsChanged } = vi.hoisted(() => ({
  listPdfViewerDocumentParts: vi.fn(),
  subscribePdfViewerDocumentsChanged: vi.fn(),
}));
vi.mock("../importDocument", () => ({ listPdfViewerDocumentParts, subscribePdfViewerDocumentsChanged }));

const { readHistory, translationNoteId, translationNoteTitle, translationNoteMarkdown, ensureTranslationFolder } =
  vi.hoisted(() => ({
    readHistory: vi.fn(),
    translationNoteId: vi.fn((id: string) => `tc-translate:${id}`),
    translationNoteTitle: vi.fn((sourceText: string) => sourceText),
    translationNoteMarkdown: vi.fn((item: { id: string }) => `md:${item.id}`),
    ensureTranslationFolder: vi.fn(),
  }));
vi.mock("../importTranslations", () => ({
  HISTORY_KEY: "tc-translate-history-v1",
  readHistory,
  translationNoteId,
  translationNoteTitle,
  translationNoteMarkdown,
  ensureTranslationFolder,
}));

import { startAutoImport } from "../autoImport";

const STORE_KEY = "tc-note-auto-imported-v1";
const HISTORY_KEY = "tc-translate-history-v1";

interface TranslationHistoryItem {
  id: string;
  createdAt: number;
  sourceText: string;
  targetLanguage: string;
  translations: unknown[];
}

// This project's vitest setup runs in plain Node without jsdom, and Node's
// experimental global `localStorage` isn't a full Storage implementation
// (no clear()/removeItem()) — so stand in a minimal in-memory version, same
// as importDocument.test.ts / onboarding.test.ts.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

// Plain Node also has no `window` global. autoImport.ts itself (not a mocked
// dependency) listens for "storage" events directly, so stand in a minimal
// EventTarget-ish stub whose listeners tests can fire manually.
function createFakeWindow() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener(type: string, cb: (event: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener(type: string, cb: (event: unknown) => void) {
      listeners.get(type)?.delete(cb);
    },
    dispatch(type: string, event: unknown) {
      for (const cb of listeners.get(type) ?? []) cb(event);
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}
type FakeWindow = ReturnType<typeof createFakeWindow>;

// autoImport.ts's scan chain is pure async/await (no internal timers), so a
// single macrotask tick reliably drains every microtask the scan queued,
// however deep the await chain — Node fully empties the microtask queue
// (including microtasks scheduled while draining it) before running any
// queued timer callback.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makePdfPart(key: string, overrides: Partial<PdfViewerDocumentPart> = {}): PdfViewerDocumentPart {
  return {
    key,
    pdfName: overrides.pdfName ?? key,
    title: overrides.title ?? key,
    content: overrides.content ?? "content",
  };
}

function makeHistoryItem(id: string, overrides: Partial<TranslationHistoryItem> = {}): TranslationHistoryItem {
  return {
    id,
    createdAt: 1,
    sourceText: overrides.sourceText ?? `source-${id}`,
    targetLanguage: overrides.targetLanguage ?? "en",
    translations: overrides.translations ?? [],
  };
}

function makeNoteMeta(id: string): NoteMeta {
  return { id, title: id, cid: `cid-${id}`, updatedAt: Date.now(), favorite: false, preview: id, folderId: null };
}

function readStore(): { v: number; keys: string[] } {
  return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{"v":1,"keys":[]}');
}

let fakeWindow: FakeWindow;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", createMemoryStorage());
  fakeWindow = createFakeWindow();
  vi.stubGlobal("window", fakeWindow);

  ensureMistNode.mockResolvedValue(undefined);
  listPdfViewerDocumentParts.mockReturnValue([]);
  subscribePdfViewerDocumentsChanged.mockReturnValue(vi.fn());
  readHistory.mockReturnValue([]);
  listFolders.mockReturnValue([]);
  createFolder.mockImplementation((name: string) => ({ id: `folder:${name}`, name, parentId: null }));
  listNotes.mockReturnValue([]);
  saveNote.mockImplementation(async (id: string, title: string) => ({ ...makeNoteMeta(id), title }));
});

describe("idempotency store: parse / cap / malformed tolerance", () => {
  it("treats missing/malformed store JSON as empty and starts importing fresh", async () => {
    localStorage.setItem(STORE_KEY, "{not json");
    listPdfViewerDocumentParts.mockReturnValue([makePdfPart("pdf:a:content")]);

    const stop = startAutoImport(vi.fn());
    await flush();
    stop();

    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(readStore().keys).toEqual(["pdf:a:content"]);
  });

  it("treats a non-object or array-shaped store as empty", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(["not", "an", "object"]));
    listPdfViewerDocumentParts.mockReturnValue([makePdfPart("pdf:a:content")]);

    const stop = startAutoImport(vi.fn());
    await flush();
    stop();

    expect(saveNote).toHaveBeenCalledTimes(1);
  });

  it("treats a store whose keys aren't all strings as empty", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, keys: ["ok", 42, null] }));
    listPdfViewerDocumentParts.mockReturnValue([makePdfPart("pdf:a:content")]);

    const stop = startAutoImport(vi.fn());
    await flush();
    stop();

    expect(saveNote).toHaveBeenCalledTimes(1);
  });

  it("caps the persisted store at the most recent 2000 keys, dropping the oldest first", async () => {
    const initialKeys = Array.from({ length: 2000 }, (_, i) => `old-key-${i}`);
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, keys: initialKeys }));
    listPdfViewerDocumentParts.mockReturnValue([makePdfPart("pdf:new:content")]);

    const stop = startAutoImport(vi.fn());
    await flush();
    stop();

    const stored = readStore();
    expect(stored.keys).toHaveLength(2000);
    expect(stored.keys).toContain("pdf:new:content");
    expect(stored.keys).not.toContain("old-key-0");
    expect(stored.keys).toContain("old-key-1");
  });
});

describe("scanning and importing", () => {
  it("imports only new pdf parts and translation items, filing them into the right folders and recording their keys", async () => {
    listPdfViewerDocumentParts.mockReturnValue([
      makePdfPart("pdf:report.pdf:content", { title: "report.pdf", content: "本文" }),
      makePdfPart("pdf:report.pdf:summary", { title: "report.pdf (要約)", content: "要約" }),
    ]);
    readHistory.mockReturnValue([makeHistoryItem("t1", { sourceText: "hello" })]);
    ensureTranslationFolder.mockReturnValue("folder-translate");

    const onImported = vi.fn();
    const stop = startAutoImport(onImported);
    await flush();
    stop();

    expect(saveNote).toHaveBeenCalledTimes(3);
    expect(saveNote).toHaveBeenCalledWith(expect.any(String), "report.pdf", "本文");
    expect(saveNote).toHaveBeenCalledWith(expect.any(String), "report.pdf (要約)", "要約");
    expect(saveNote).toHaveBeenCalledWith("tc-translate:t1", "hello", "md:t1");

    expect(createFolder).toHaveBeenCalledWith("PDF資料");
    expect(setNoteFolder).toHaveBeenCalledWith(expect.any(String), "folder:PDF資料");
    expect(setNoteFolder).toHaveBeenCalledWith("tc-translate:t1", "folder-translate");

    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledWith(3);

    expect(readStore().keys.sort()).toEqual(["pdf:report.pdf:content", "pdf:report.pdf:summary", "tr:t1"].sort());
  });

  it("does not re-import items already recorded by a previous scan (idempotent re-scan)", async () => {
    listPdfViewerDocumentParts.mockReturnValue([makePdfPart("pdf:a:content")]);

    const onImported = vi.fn();
    const stop = startAutoImport(onImported);
    await flush();
    expect(saveNote).toHaveBeenCalledTimes(1);

    const onChanged = subscribePdfViewerDocumentsChanged.mock.calls[0][0] as () => void;
    onChanged();
    await flush();

    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not resurrect a pdf part whose resulting note was deleted", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, keys: ["pdf:a:content"] }));
    listPdfViewerDocumentParts.mockReturnValue([makePdfPart("pdf:a:content")]);
    listNotes.mockReturnValue([]); // the note was deleted; index has no trace of it

    const onImported = vi.fn();
    const stop = startAutoImport(onImported);
    await flush();
    stop();

    expect(saveNote).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("does not resurrect a translation note whose id was already recorded, even if deleted", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, keys: ["tr:t1"] }));
    readHistory.mockReturnValue([makeHistoryItem("t1")]);
    listNotes.mockReturnValue([]); // tc-translate:t1 note was deleted

    const onImported = vi.fn();
    const stop = startAutoImport(onImported);
    await flush();
    stop();

    expect(saveNote).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("records the key without creating a duplicate note when a tc-translate:<id> note already exists", async () => {
    readHistory.mockReturnValue([makeHistoryItem("t2")]);
    listNotes.mockReturnValue([makeNoteMeta("tc-translate:t2")]);

    const onImported = vi.fn();
    const stop = startAutoImport(onImported);
    await flush();
    stop();

    expect(saveNote).not.toHaveBeenCalled();
    expect(setNoteFolder).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(readStore().keys).toEqual(["tr:t2"]);
  });

  it("continues importing remaining items when one item's creation throws", async () => {
    listPdfViewerDocumentParts.mockReturnValue([
      makePdfPart("pdf:bad:content", { title: "bad-one" }),
      makePdfPart("pdf:good:content", { title: "good-one" }),
    ]);
    saveNote.mockImplementation(async (id: string, title: string) => {
      if (title === "bad-one") throw new Error("boom");
      return makeNoteMeta(id);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const onImported = vi.fn();
    const stop = startAutoImport(onImported);
    await flush();
    stop();

    expect(onImported).toHaveBeenCalledWith(1);
    expect(readStore().keys).toEqual(["pdf:good:content"]); // failed item's key is not recorded, so it can retry
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("calls onImported with the created count only when it is greater than 0", async () => {
    const onImported = vi.fn();
    let stop = startAutoImport(onImported);
    await flush();
    expect(onImported).not.toHaveBeenCalled();
    stop();

    listPdfViewerDocumentParts.mockReturnValue([makePdfPart("pdf:b:content"), makePdfPart("pdf:b:summary")]);
    onImported.mockClear();
    stop = startAutoImport(onImported);
    await flush();
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledWith(2);
    stop();
  });
});

describe("triggers and concurrency", () => {
  it("re-scans on a storage event for the translation history key, but not for unrelated keys", async () => {
    const stop = startAutoImport(vi.fn());
    await flush();
    const callsAfterInitial = ensureMistNode.mock.calls.length;

    fakeWindow.dispatch("storage", { key: "some-other-key" });
    await flush();
    expect(ensureMistNode).toHaveBeenCalledTimes(callsAfterInitial);

    fakeWindow.dispatch("storage", { key: HISTORY_KEY });
    await flush();
    expect(ensureMistNode).toHaveBeenCalledTimes(callsAfterInitial + 1);

    stop();
  });

  it("queues exactly one re-scan when triggers fire while a scan is in flight", async () => {
    listPdfViewerDocumentParts.mockReturnValue([makePdfPart("pdf:slow:content")]);
    let resolveSave: () => void = () => {};
    saveNote.mockImplementation(
      () =>
        new Promise<NoteMeta>((resolve) => {
          resolveSave = () => resolve(makeNoteMeta("slow"));
        }),
    );

    const stop = startAutoImport(vi.fn());
    // Give the initial scan a chance to reach (and block on) saveNote.
    await Promise.resolve();
    await Promise.resolve();

    const onChanged = subscribePdfViewerDocumentsChanged.mock.calls[0][0] as () => void;
    onChanged();
    onChanged();
    onChanged();

    expect(ensureMistNode).toHaveBeenCalledTimes(1); // still just the in-flight scan

    resolveSave();
    await flush();

    // Exactly one coalesced re-scan should have run after the first finished.
    expect(ensureMistNode).toHaveBeenCalledTimes(2);
    expect(saveNote).toHaveBeenCalledTimes(1); // the part was already recorded by scan 1

    stop();
  });

  it("stop() unsubscribes triggers and prevents any further scan from starting", async () => {
    const stop = startAutoImport(vi.fn());
    await flush();
    const callsAfterInitial = ensureMistNode.mock.calls.length;

    stop();

    const onChanged = subscribePdfViewerDocumentsChanged.mock.calls[0][0] as () => void;
    onChanged();
    fakeWindow.dispatch("storage", { key: HISTORY_KEY });
    await flush();

    expect(ensureMistNode).toHaveBeenCalledTimes(callsAfterInitial);
  });
});

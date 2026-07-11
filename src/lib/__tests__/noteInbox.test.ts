import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NoteMeta } from "../mistlib";

// noteInbox.ts only needs mistlib's note/folder-creation surface and
// mistNode's readiness gate — mock both directly, matching autoImport.test.ts's
// style of mocking ../mistlib rather than the underlying wasm store. The
// vendored mistlib wrapper (storage_get) is mocked too since resolveItem is
// overridden in these tests and never exercises the real one.
const { saveNote, setNoteFolder, listFolders, createFolder } = vi.hoisted(() => ({
  saveNote: vi.fn(),
  setNoteFolder: vi.fn(),
  listFolders: vi.fn(),
  createFolder: vi.fn(),
}));
vi.mock("../mistlib", () => ({ saveNote, setNoteFolder, listFolders, createFolder }));

const { ensureMistNode } = vi.hoisted(() => ({ ensureMistNode: vi.fn() }));
vi.mock("../mistNode", () => ({ ensureMistNode }));

const { storage_get } = vi.hoisted(() => ({ storage_get: vi.fn() }));
vi.mock("../../vendor/mistlib/wrappers/web/index.js", () => ({ storage_get }));

import {
  createNoteInboxActions,
  isTextLikeItem,
  loadImportedIds,
  parseHandoffItems,
  saveImportedIds,
  titleFromFileName,
  type FileHandoffItem,
  type ResolveItemResult,
} from "../noteInbox";

const IMPORTED_IDS_KEY = "tc-note-inbox-imported-v1";

// This project's vitest setup runs in plain Node without jsdom, and Node's
// experimental global `localStorage` isn't a full Storage implementation
// (no clear()/removeItem()) — so stand in a minimal in-memory version, same
// as autoImport.test.ts / importDocument.test.ts.
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

function item(id: string, overrides: Partial<FileHandoffItem> = {}): FileHandoffItem {
  return {
    id,
    name: `${id}.md`,
    mimeType: "text/markdown",
    size: 4,
    checksum: `checksum-${id}`,
    cid: `cid-${id}`,
    key: "a2V5",
    iv: "aXY=",
    addedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function makeNoteMeta(id: string, title: string): NoteMeta {
  return { id, title, cid: `cid-${id}`, updatedAt: Date.now(), favorite: false, preview: title, folderId: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", createMemoryStorage());
  listFolders.mockReturnValue([]);
  createFolder.mockImplementation((name: string) => ({ id: `folder:${name}`, name, parentId: null }));
  saveNote.mockImplementation(async (id: string, title: string) => makeNoteMeta(id, title));
});

describe("parseHandoffItems", () => {
  it("returns an empty list when meta is missing or has no items", () => {
    expect(parseHandoffItems(undefined)).toEqual([]);
    expect(parseHandoffItems({})).toEqual([]);
    expect(parseHandoffItems({ items: "not-an-array" })).toEqual([]);
  });

  it("parses well-formed items", () => {
    const good = item("a");
    expect(parseHandoffItems({ items: [good] })).toEqual([good]);
  });

  it("skips malformed entries but keeps valid ones", () => {
    const good = item("good");
    const meta = {
      items: [null, "not-an-object", { id: "missing-fields" }, good, { ...good, id: "bad-size", size: "not-a-number" }],
    };
    expect(parseHandoffItems(meta)).toEqual([good]);
  });
});

describe("isTextLikeItem", () => {
  it("accepts any text/* mime type", () => {
    expect(isTextLikeItem({ name: "file", mimeType: "text/plain" })).toBe(true);
    expect(isTextLikeItem({ name: "file", mimeType: "text/csv" })).toBe(true);
  });

  it("accepts recognized text-ish extensions regardless of mime type", () => {
    expect(isTextLikeItem({ name: "readme.md", mimeType: "application/octet-stream" })).toBe(true);
    expect(isTextLikeItem({ name: "notes.MARKDOWN", mimeType: "" })).toBe(true);
    expect(isTextLikeItem({ name: "data.json", mimeType: "application/octet-stream" })).toBe(true);
  });

  it("rejects binary files", () => {
    expect(isTextLikeItem({ name: "photo.png", mimeType: "image/png" })).toBe(false);
    expect(isTextLikeItem({ name: "archive.zip", mimeType: "application/zip" })).toBe(false);
  });
});

describe("titleFromFileName", () => {
  it("strips a trailing extension", () => {
    expect(titleFromFileName("readme.md")).toBe("readme");
    expect(titleFromFileName("notes.markdown")).toBe("notes");
  });

  it("falls back to the full name when there is no extension, or Untitled when empty", () => {
    expect(titleFromFileName("readme")).toBe("readme");
    expect(titleFromFileName("")).toBe("Untitled");
  });
});

describe("imported-id idempotency store", () => {
  it("treats missing/malformed storage as an empty set", () => {
    expect(loadImportedIds()).toEqual(new Set());
    localStorage.setItem(IMPORTED_IDS_KEY, "{not json");
    expect(loadImportedIds()).toEqual(new Set());
    localStorage.setItem(IMPORTED_IDS_KEY, JSON.stringify({ not: "an array" }));
    expect(loadImportedIds()).toEqual(new Set());
  });

  it("round-trips a set of ids through save/load", () => {
    saveImportedIds(new Set(["a", "b", "c"]));
    expect(loadImportedIds()).toEqual(new Set(["a", "b", "c"]));
  });

  it("caps the persisted list at the most recent 1000 ids, dropping the oldest first", () => {
    const ids = new Set(Array.from({ length: 1001 }, (_, i) => `id-${i}`));
    saveImportedIds(ids);
    const stored = JSON.parse(localStorage.getItem(IMPORTED_IDS_KEY)!) as string[];
    expect(stored).toHaveLength(1000);
    expect(stored).not.toContain("id-0");
    expect(stored).toContain("id-1000");
  });
});

describe("createNoteInboxActions", () => {
  function harness(resolveItem: (item: FileHandoffItem) => Promise<ResolveItemResult>) {
    const onImported = vi.fn();
    const actions = createNoteInboxActions(onImported, { resolveItem });
    return { actions, onImported };
  }

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function importedIds(): string[] {
    return JSON.parse(localStorage.getItem(IMPORTED_IDS_KEY) ?? "[]") as string[];
  }

  it("a transient resolve failure is not recorded as imported, so it retries on the next event", async () => {
    let attempts = 0;
    const { actions } = harness(async () => {
      attempts++;
      return { kind: "transient" };
    });

    actions.importFromInbox({ cid: "", meta: { items: [item("a")] }, updatedAt: "2026-07-10T00:00:00.000Z", from: "tc-storage" });
    await settle();

    expect(attempts).toBe(1);
    expect(importedIds()).toEqual([]);
    expect(saveNote).not.toHaveBeenCalled();

    actions.importFromInbox({ cid: "", meta: { items: [item("a")] }, updatedAt: "2026-07-10T00:00:01.000Z", from: "tc-storage" });
    await settle();

    expect(attempts).toBe(2);
    expect(importedIds()).toEqual([]);
  });

  it("a permanent resolve failure (non-text / checksum mismatch / decrypt failure) is marked imported and never retried", async () => {
    let attempts = 0;
    const { actions } = harness(async () => {
      attempts++;
      return { kind: "permanent" };
    });

    actions.importFromInbox({ cid: "", meta: { items: [item("b")] }, updatedAt: "2026-07-10T00:00:00.000Z", from: "tc-storage" });
    await settle();

    expect(attempts).toBe(1);
    expect(importedIds()).toEqual(["b"]);
    expect(saveNote).not.toHaveBeenCalled();

    actions.importFromInbox({ cid: "", meta: { items: [item("b")] }, updatedAt: "2026-07-10T00:00:01.000Z", from: "tc-storage" });
    await settle();

    expect(attempts).toBe(1);
  });

  it("a resolved item is saved as a note, filed into the inbox folder, and reported via onImported", async () => {
    const { actions, onImported } = harness(async () => ({ kind: "resolved", name: "c.md", text: "hello" }));

    actions.importFromInbox({ cid: "", meta: { items: [item("c")] }, updatedAt: "2026-07-10T00:00:00.000Z", from: "tc-storage" });
    await settle();

    expect(importedIds()).toEqual(["c"]);
    expect(saveNote).toHaveBeenCalledWith(expect.any(String), "c", "hello");
    expect(createFolder).toHaveBeenCalledWith("tc-storageから追加");
    expect(setNoteFolder).toHaveBeenCalledWith(expect.any(String), "folder:tc-storageから追加");
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onImported.mock.calls[0][0]).toHaveLength(1);
    expect(onImported.mock.calls[0][0][0].title).toBe("c");
  });

  it("reuses an existing inbox folder instead of creating a duplicate", async () => {
    listFolders.mockReturnValue([{ id: "existing-folder", name: "tc-storageから追加", parentId: null }]);
    const { actions } = harness(async () => ({ kind: "resolved", name: "d.md", text: "hi" }));

    actions.importFromInbox({ cid: "", meta: { items: [item("d")] }, updatedAt: "2026-07-10T00:00:00.000Z", from: "tc-storage" });
    await settle();

    expect(createFolder).not.toHaveBeenCalled();
    expect(setNoteFolder).toHaveBeenCalledWith(expect.any(String), "existing-folder");
  });

  it("a mix of transient, permanent, and resolved items in one republish is handled independently", async () => {
    const { actions, onImported } = harness(async (current) => {
      if (current.id === "transient-id") return { kind: "transient" };
      if (current.id === "permanent-id") return { kind: "permanent" };
      return { kind: "resolved", name: "resolved-id.txt", text: "hello" };
    });

    actions.importFromInbox({
      cid: "",
      meta: { items: [item("transient-id"), item("permanent-id"), item("resolved-id")] },
      updatedAt: "2026-07-10T00:00:00.000Z",
      from: "tc-storage",
    });
    await settle();

    expect(importedIds().toSorted()).toEqual(["permanent-id", "resolved-id"]);
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onImported.mock.calls[0][0]).toHaveLength(1);
  });

  it("does not re-import an already-recorded id on a republish of the same list", async () => {
    const { actions, onImported } = harness(async () => ({ kind: "resolved", name: "e.md", text: "hi" }));

    actions.importFromInbox({ cid: "", meta: { items: [item("e")] }, updatedAt: "2026-07-10T00:00:00.000Z", from: "tc-storage" });
    await settle();
    expect(saveNote).toHaveBeenCalledTimes(1);

    actions.importFromInbox({ cid: "", meta: { items: [item("e")] }, updatedAt: "2026-07-10T00:00:01.000Z", from: "tc-storage" });
    await settle();

    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("leaves a note-creation failure out of the imported set so it retries later", async () => {
    saveNote.mockRejectedValueOnce(new Error("boom"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { actions, onImported } = harness(async () => ({ kind: "resolved", name: "f.md", text: "hi" }));

    actions.importFromInbox({ cid: "", meta: { items: [item("f")] }, updatedAt: "2026-07-10T00:00:00.000Z", from: "tc-storage" });
    await settle();

    expect(importedIds()).toEqual([]);
    expect(onImported).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

// importTranslations.ts only needs mistNode's readiness gate and the
// vendored mistlib wrapper's storage_get (for the bodyCid dual-read path),
// so mock both directly, matching importDocument.test.ts / noteInbox.test.ts.
const { ensureMistNode } = vi.hoisted(() => ({ ensureMistNode: vi.fn() }));
vi.mock("../mistNode", () => ({ ensureMistNode }));

const { storage_get } = vi.hoisted(() => ({ storage_get: vi.fn() }));
vi.mock("../../vendor/mistlib/wrappers/web/index.js", () => ({ storage_get }));

import { readHistory, HISTORY_KEY } from "../importTranslations";

// This project's vitest setup runs in plain Node without jsdom, and Node's
// experimental global `localStorage` isn't a full Storage implementation
// (no clear()/removeItem()) — so stand in a minimal in-memory version, same
// as importDocument.test.ts / autoImport.test.ts.
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", createMemoryStorage());
  ensureMistNode.mockResolvedValue(undefined);
});

describe("readHistory", () => {
  it("returns an empty list when the key is missing", async () => {
    expect(await readHistory()).toEqual([]);
  });

  it("reads old-format items with every field inlined", async () => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify([
        { id: "t1", createdAt: 100, sourceText: "你好", targetLanguage: "en", translations: [{ tone: "casual", text: "hi" }] },
      ]),
    );

    const history = await readHistory();
    expect(history).toEqual([
      { id: "t1", createdAt: 100, sourceText: "你好", targetLanguage: "en", translations: [{ tone: "casual", text: "hi" }] },
    ]);
    expect(storage_get).not.toHaveBeenCalled();
  });

  it("dual-reads a new-format item that carries only a preview + bodyCid (contract B)", async () => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify([{ id: "t2", createdAt: 200, targetLanguage: "en", sourcePreview: "你好…", bodyCid: "bafy-body-1" }]),
    );
    storage_get.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify({ sourceText: "你好，世界", translations: [{ tone: "formal", text: "Hello, world" }] })),
    );

    const history = await readHistory();
    expect(history).toEqual([
      { id: "t2", createdAt: 200, sourceText: "你好，世界", targetLanguage: "en", translations: [{ tone: "formal", text: "Hello, world" }] },
    ]);
    expect(storage_get).toHaveBeenCalledWith("bafy-body-1");
  });

  it("skips a new-format item whose bodyCid fails to resolve, without throwing", async () => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify([
        { id: "bad", createdAt: 1, targetLanguage: "en", sourcePreview: "x", bodyCid: "bafy-missing" },
        { id: "ok", createdAt: 2, sourceText: "y", targetLanguage: "en", translations: [] },
      ]),
    );
    storage_get.mockRejectedValue(new Error("not found"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const history = await readHistory();
    expect(history).toEqual([{ id: "ok", createdAt: 2, sourceText: "y", targetLanguage: "en", translations: [] }]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns an empty list when the stored JSON is malformed", async () => {
    localStorage.setItem(HISTORY_KEY, "{not json");
    expect(await readHistory()).toEqual([]);
  });
});

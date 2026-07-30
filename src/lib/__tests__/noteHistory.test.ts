import { describe, it, expect, beforeEach, vi } from "vitest";
import { addHistoryEntry, pruneHistoryMap, recordVersion, listVersions, clearHistory, type HistoryEntry } from "../noteHistory";

const HISTORY_KEY = "tc-note:history";
const INDEX_KEY = "tc-note:index";

// This project's vitest setup runs in plain Node without jsdom, and Node's
// experimental global `localStorage` isn't a full Storage implementation
// (no clear()/removeItem()) — so stand in a minimal in-memory version, same
// convention as llmSettings.test.ts.
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
  vi.stubGlobal("localStorage", createMemoryStorage());
});

describe("addHistoryEntry (pure)", () => {
  it("prepends a new entry, newest first", () => {
    const entries: HistoryEntry[] = [{ cid: "a", at: 100, chars: 10 }];
    const next = addHistoryEntry(entries, "b", 20, 200);
    expect(next).toEqual([
      { cid: "b", at: 200, chars: 20 },
      { cid: "a", at: 100, chars: 10 },
    ]);
  });

  it("is a no-op when the cid matches the newest entry (dedupe identical saves)", () => {
    const entries: HistoryEntry[] = [{ cid: "a", at: 100, chars: 10 }];
    const next = addHistoryEntry(entries, "a", 999, 500);
    expect(next).toBe(entries);
  });

  it("still records a version whose cid matches an older (non-newest) entry", () => {
    // Content-addressing means reverting to exact prior content reproduces
    // an old cid — that's a legitimate new history point (a "restore"), not
    // a duplicate save, so only the *newest* entry's cid should suppress it.
    const entries: HistoryEntry[] = [
      { cid: "b", at: 200, chars: 20 },
      { cid: "a", at: 100, chars: 10 },
    ];
    const next = addHistoryEntry(entries, "a", 10, 300);
    expect(next[0]).toEqual({ cid: "a", at: 300, chars: 10 });
    expect(next).toHaveLength(3);
  });

  it("caps at the given limit, dropping the oldest entries", () => {
    let entries: HistoryEntry[] = [];
    for (let i = 0; i < 25; i++) {
      entries = addHistoryEntry(entries, `cid-${i}`, i, i, 20);
    }
    expect(entries).toHaveLength(20);
    expect(entries[0].cid).toBe("cid-24"); // newest
    expect(entries[entries.length - 1].cid).toBe("cid-5"); // oldest kept
  });

  it("defaults to a cap of 20 when none is given", () => {
    let entries: HistoryEntry[] = [];
    for (let i = 0; i < 25; i++) {
      entries = addHistoryEntry(entries, `cid-${i}`, i, i);
    }
    expect(entries).toHaveLength(20);
  });
});

describe("pruneHistoryMap (pure)", () => {
  it("drops keys not present in knownIds", () => {
    const map = {
      n1: [{ cid: "a", at: 1, chars: 1 }],
      n2: [{ cid: "b", at: 2, chars: 2 }],
    };
    const next = pruneHistoryMap(map, new Set(["n1"]));
    expect(next).toEqual({ n1: map.n1 });
  });

  it("keeps everything when all ids are known", () => {
    const map = { n1: [{ cid: "a", at: 1, chars: 1 }] };
    expect(pruneHistoryMap(map, new Set(["n1", "n2"]))).toEqual(map);
  });
});

describe("recordVersion / listVersions (localStorage-backed)", () => {
  beforeEach(() => {
    localStorage.setItem(INDEX_KEY, JSON.stringify([{ id: "n1" }, { id: "n2" }]));
  });

  it("round-trips through localStorage", () => {
    recordVersion("n1", "cid-1", 100);
    expect(listVersions("n1")).toEqual([{ cid: "cid-1", at: expect.any(Number), chars: 100 }]);
  });

  it("returns an empty array for a note with no history", () => {
    expect(listVersions("nope")).toEqual([]);
  });

  it("does not record a duplicate save with the same cid", () => {
    recordVersion("n1", "cid-1", 100);
    recordVersion("n1", "cid-1", 100);
    expect(listVersions("n1")).toHaveLength(1);
  });

  it("records successive distinct saves, newest first", () => {
    recordVersion("n1", "cid-1", 10);
    recordVersion("n1", "cid-2", 20);
    const versions = listVersions("n1");
    expect(versions.map((v) => v.cid)).toEqual(["cid-2", "cid-1"]);
  });

  it("tolerates corrupt JSON in the history key by starting fresh", () => {
    localStorage.setItem(HISTORY_KEY, "{not json");
    recordVersion("n1", "cid-1", 10);
    expect(listVersions("n1")).toEqual([{ cid: "cid-1", at: expect.any(Number), chars: 10 }]);
  });

  it("tolerates a missing history key", () => {
    expect(listVersions("n1")).toEqual([]);
  });

  it("prunes history for note ids no longer in the note index on write", () => {
    recordVersion("n1", "cid-1", 10);
    recordVersion("n2", "cid-2", 20);
    // n2 gets deleted from the index (mistlib.ts's deleteNote would also call
    // clearHistory directly, but this covers stray/pre-existing entries too).
    localStorage.setItem(INDEX_KEY, JSON.stringify([{ id: "n1" }]));
    recordVersion("n1", "cid-3", 30);
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY)!);
    expect(Object.keys(raw)).toEqual(["n1"]);
  });

  it("keeps history for a brand-new note not yet reflected in a stale index read", () => {
    localStorage.setItem(INDEX_KEY, JSON.stringify([]));
    recordVersion("n3", "cid-1", 10);
    expect(listVersions("n3")).toHaveLength(1);
  });
});

describe("clearHistory", () => {
  it("removes a note's recorded versions", () => {
    localStorage.setItem(INDEX_KEY, JSON.stringify([{ id: "n1" }]));
    recordVersion("n1", "cid-1", 10);
    clearHistory("n1");
    expect(listVersions("n1")).toEqual([]);
  });

  it("is a no-op for a note with no history", () => {
    expect(() => clearHistory("nope")).not.toThrow();
  });

  it("leaves other notes' history untouched", () => {
    localStorage.setItem(INDEX_KEY, JSON.stringify([{ id: "n1" }, { id: "n2" }]));
    recordVersion("n1", "cid-1", 10);
    recordVersion("n2", "cid-2", 20);
    clearHistory("n1");
    expect(listVersions("n1")).toEqual([]);
    expect(listVersions("n2")).toHaveLength(1);
  });
});

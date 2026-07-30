import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  addHistoryEntry,
  thinHistory,
  pruneHistoryMap,
  recordVersion,
  listVersions,
  clearHistory,
  type HistoryEntry,
} from "../noteHistory";

const HISTORY_KEY = "tc-note:history";
const INDEX_KEY = "tc-note:index";

// Mirrors the private constants in noteHistory.ts — kept duplicated here
// (not imported) so the tests pin down the *contract* thinHistory must
// honor, not just whatever the implementation currently does.
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const RECENT_WINDOW = 10 * MIN;
const HOURLY_HORIZON = DAY; // 10 min .. 24h: one entry per hour
const DAILY_HORIZON = 30 * DAY; // 24h .. 30 days: one entry per day

// An hour- and day-aligned anchor (an exact multiple of both DAY and HOUR),
// so bucket-floor arithmetic in the tests below lines up exactly instead of
// depending on whatever moment the test happens to run.
const NOW = 20000 * DAY;

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

});

describe("thinHistory (pure)", () => {
  it("keeps every entry within the last 10 minutes", () => {
    const entries: HistoryEntry[] = [
      { cid: "a", at: NOW, chars: 1 },
      { cid: "b", at: NOW - 1 * MIN, chars: 1 },
      { cid: "c", at: NOW - 5 * MIN, chars: 1 },
      { cid: "d", at: NOW - 9 * MIN, chars: 1 },
      { cid: "e", at: NOW - (RECENT_WINDOW - 1), chars: 1 }, // 1ms inside the window
    ];
    expect(thinHistory(entries, NOW)).toEqual(entries);
  });

  it("collapses a burst of saves seconds apart once they age past the 10-minute window", () => {
    // Every 30s from "just now" out to 40 minutes ago: 81 entries.
    const entries: HistoryEntry[] = [];
    for (let offset = 0; offset <= 40 * MIN; offset += 30 * 1000) {
      entries.push({ cid: `t${offset}`, at: NOW - offset, chars: offset });
    }
    const thinned = thinHistory(entries, NOW);

    // Entries younger than RECENT_WINDOW (offsets 0..570000 in 30s steps,
    // 20 of them) all survive individually...
    const recentOffsets = entries.filter((e) => NOW - e.at < RECENT_WINDOW);
    expect(recentOffsets).toHaveLength(20);
    for (const e of recentOffsets) expect(thinned).toContainEqual(e);

    // ...and every older entry in that same 40-minute span shares one hour
    // bucket, collapsing to just its newest member: offset exactly
    // RECENT_WINDOW (600000ms = 10 min), the first one old enough to leave
    // the recent window.
    const hourlyRepresentative = entries.find((e) => NOW - e.at === RECENT_WINDOW)!;
    expect(thinned).toContainEqual(hourlyRepresentative);
    expect(thinned).toHaveLength(21);
  });

  it("keeps at most one entry per hour, the newest, for 10-minute-to-24-hour-old entries", () => {
    const e1 = { cid: "e1-20m", at: NOW - 20 * MIN, chars: 1 }; // hour bucket A, newer
    const e2 = { cid: "e2-45m", at: NOW - 45 * MIN, chars: 1 }; // hour bucket A, older -> dropped
    const e3 = { cid: "e3-1h20m", at: NOW - 80 * MIN, chars: 1 }; // hour bucket B
    const e4 = { cid: "e4-2h20m", at: NOW - 140 * MIN, chars: 1 }; // hour bucket C
    const e5 = { cid: "e5-3h20m", at: NOW - 200 * MIN, chars: 1 }; // hour bucket D

    const thinned = thinHistory([e1, e2, e3, e4, e5], NOW);
    expect(thinned.map((e) => e.cid)).toEqual(["e1-20m", "e3-1h20m", "e4-2h20m", "e5-3h20m"]);
  });

  it("keeps at most one entry per day, the newest, for 24-hour-to-30-day-old entries", () => {
    const d1 = { cid: "d1-26h", at: NOW - 26 * HOUR, chars: 1 }; // day bucket A, newer
    const d2 = { cid: "d2-29h", at: NOW - 29 * HOUR, chars: 1 }; // day bucket A, older -> dropped
    const d3 = { cid: "d3-2d5h", at: NOW - 53 * HOUR, chars: 1 }; // day bucket B
    const d4 = { cid: "d4-3d5h", at: NOW - 77 * HOUR, chars: 1 }; // day bucket C

    const thinned = thinHistory([d1, d2, d3, d4], NOW);
    expect(thinned.map((e) => e.cid)).toEqual(["d1-26h", "d3-2d5h", "d4-3d5h"]);
  });

  it("drops entries older than 30 days", () => {
    const fresh = { cid: "fresh", at: NOW, chars: 1 };
    const justUnder = { cid: "just-under-30d", at: NOW - (DAILY_HORIZON - 1000), chars: 1 };
    const tooOld = { cid: "too-old", at: NOW - 40 * DAY, chars: 1 };

    const thinned = thinHistory([fresh, justUnder, tooOld], NOW);
    expect(thinned.map((e) => e.cid)).toEqual(["fresh", "just-under-30d"]);
  });

  it("never drops the single newest entry, even if it's older than 30 days", () => {
    const onlyOld = { cid: "only-old", at: NOW - 40 * DAY, chars: 1 };
    expect(thinHistory([onlyOld], NOW)).toEqual([onlyOld]);
  });

  it("is exact at the 10-minute recent/hourly boundary (age === RECENT_WINDOW is NOT recent)", () => {
    const fresh = { cid: "fresh", at: NOW, chars: 1 };
    const edge = { cid: "edge-10m", at: NOW - RECENT_WINDOW, chars: 1 }; // age exactly 600000ms
    // Shares edge's hour bucket only if edge is correctly routed there (not
    // treated as still-recent) — a genuinely-recent-window entry that also
    // happens to land in that same hour bucket once it's old enough itself.
    const sameHourButOlder = { cid: "same-hour-older", at: NOW - RECENT_WINDOW - 10 * 1000, chars: 1 };

    const thinned = thinHistory([fresh, edge, sameHourButOlder], NOW);
    // edge wins its hour bucket (it's newer than sameHourButOlder); if edge
    // had wrongly stayed in the "recent" tier instead, sameHourButOlder
    // would independently claim that hour bucket too and both would survive.
    expect(thinned.map((e) => e.cid)).toEqual(["fresh", "edge-10m"]);
  });

  it("is exact at the 24-hour hourly/daily boundary (age === HOURLY_HORIZON is NOT hourly)", () => {
    const fresh = { cid: "fresh", at: NOW, chars: 1 };
    const edge = { cid: "edge-24h", at: NOW - HOURLY_HORIZON, chars: 1 }; // age exactly 86400000ms
    // Falls in the *same hour bucket* edge would occupy if it were (wrongly)
    // still treated as hourly-tier — but is itself genuinely hourly-tier
    // (age just under 24h), so it only collides with edge under that bug.
    const sameHourIfMisclassified = { cid: "same-hour-if-bug", at: NOW - HOURLY_HORIZON + 1000, chars: 1 };

    const thinned = thinHistory([fresh, edge, sameHourIfMisclassified], NOW);
    // Correct behavior: edge is daily-tier (separate "d:" namespace), so it
    // never collides with sameHourIfMisclassified's "h:" bucket — all three
    // survive. A buggy `<=` instead of `<` would drop edge here.
    expect(thinned.map((e) => e.cid).sort()).toEqual(["edge-24h", "fresh", "same-hour-if-bug"].sort());
  });

  it("is exact at the 30-day daily/drop boundary (age === DAILY_HORIZON is dropped, not daily)", () => {
    const fresh = { cid: "fresh", at: NOW, chars: 1 };
    const edge = { cid: "edge-30d", at: NOW - DAILY_HORIZON, chars: 1 }; // age exactly 30 days
    const thinned = thinHistory([fresh, edge], NOW);
    expect(thinned.map((e) => e.cid)).toEqual(["fresh"]);
  });

  it("caps at ~100 entries overall, keeping the newest, even when all are within the recent window", () => {
    const entries: HistoryEntry[] = [];
    for (let i = 0; i < 150; i++) {
      entries.push({ cid: `r${i}`, at: NOW - i * 1000, chars: i }); // 150 entries, 1s apart, all < 10min old
    }
    const thinned = thinHistory(entries, NOW);
    expect(thinned).toHaveLength(100);
    expect(thinned[0].cid).toBe("r0"); // newest always survives
    expect(thinned.map((e) => e.cid)).toEqual(entries.slice(0, 100).map((e) => e.cid));
  });

  it("sorts unordered input by recency before thinning (tolerates stored data in any order)", () => {
    const a = { cid: "a", at: NOW - 5 * MIN, chars: 1 };
    const b = { cid: "b", at: NOW, chars: 1 };
    const c = { cid: "c", at: NOW - 8 * MIN, chars: 1 };
    // Deliberately not newest-first.
    expect(thinHistory([a, c, b], NOW)).toEqual([b, a, c]);
  });

  it("returns an empty array unchanged", () => {
    expect(thinHistory([], NOW)).toEqual([]);
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

  it("thins a flat-capped list from before this module had age-bucketed retention, without throwing", () => {
    // Shape written by the old code (a flat cap at 20, no thinning) —
    // existing users already have data like this sitting in localStorage.
    // Spread across the last ~40 hours so recording one more version
    // exercises the recent/hourly/daily bucketing on top of it.
    const now = Date.now();
    const legacy: HistoryEntry[] = [];
    for (let i = 0; i < 20; i++) {
      legacy.push({ cid: `legacy-${i}`, at: now - i * (2 * 60 * 60 * 1000), chars: i * 10 });
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ n1: legacy }));

    expect(() => recordVersion("n1", "fresh-cid", 999)).not.toThrow();

    const versions = listVersions("n1");
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0]).toMatchObject({ cid: "fresh-cid", chars: 999 });
    // Thinning actually ran: 20 entries spaced 2 hours apart span well past
    // the "one per hour" window, so the stored list should be visibly
    // smaller than the legacy 20 + 1 new = 21.
    expect(versions.length).toBeLessThan(legacy.length + 1);
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

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NoteMeta } from "../mistlib";

// noteDocExport.ts only needs mistlib's listNotes and sharedBus's
// publishShared — mock both directly, matching autoImport.test.ts's style of
// mocking ../mistlib rather than the underlying wasm store.
const { listNotes } = vi.hoisted(() => ({ listNotes: vi.fn() }));
vi.mock("../mistlib", () => ({ listNotes }));

const { publishShared } = vi.hoisted(() => ({ publishShared: vi.fn() }));
vi.mock("../sharedBus", () => ({ publishShared }));

import { buildNoteDocIndexEntries, publishNoteDocIndex, schedulePublishNoteDocIndex } from "../noteDocExport";

function makeNote(id: string, overrides: Partial<NoteMeta> = {}): NoteMeta {
  return {
    id,
    title: overrides.title ?? `title-${id}`,
    cid: overrides.cid !== undefined ? overrides.cid : `cid-${id}`,
    updatedAt: overrides.updatedAt ?? 0,
    favorite: overrides.favorite ?? false,
    preview: overrides.preview ?? "",
    folderId: overrides.folderId ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildNoteDocIndexEntries", () => {
  it("maps notes to the id/title/cid/updatedAt entry shape", () => {
    const notes = [makeNote("a", { title: "Alpha", cid: "bafyA", updatedAt: 10 })];
    expect(buildNoteDocIndexEntries(notes)).toEqual([{ id: "a", title: "Alpha", cid: "bafyA", updatedAt: 10 }]);
  });

  it("filters out notes whose cid is null (never saved)", () => {
    const notes = [makeNote("a", { cid: null }), makeNote("b", { cid: "bafyB" })];
    const result = buildNoteDocIndexEntries(notes);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("sorts by updatedAt descending", () => {
    const notes = [
      makeNote("old", { updatedAt: 1 }),
      makeNote("newest", { updatedAt: 3 }),
      makeNote("mid", { updatedAt: 2 }),
    ];
    expect(buildNoteDocIndexEntries(notes).map((n) => n.id)).toEqual(["newest", "mid", "old"]);
  });

  it("caps the index at the 500 most recently updated notes", () => {
    const notes = Array.from({ length: 550 }, (_, i) => makeNote(`n${i}`, { updatedAt: i }));
    const result = buildNoteDocIndexEntries(notes);
    expect(result).toHaveLength(500);
    // Most recent 500 (updatedAt 549 down to 50), newest first.
    expect(result[0].id).toBe("n549");
    expect(result[result.length - 1].id).toBe("n50");
    expect(result.find((n) => n.id === "n49")).toBeUndefined();
  });

  it("returns an empty list for an empty note index", () => {
    expect(buildNoteDocIndexEntries([])).toEqual([]);
  });
});

describe("publishNoteDocIndex", () => {
  it("publishes the built entries wholesale onto the note-doc-index topic with an empty cid", () => {
    listNotes.mockReturnValue([makeNote("a", { title: "Alpha", cid: "bafyA", updatedAt: 5 })]);

    publishNoteDocIndex();

    expect(publishShared).toHaveBeenCalledTimes(1);
    expect(publishShared).toHaveBeenCalledWith("note-doc-index", "", {
      notes: [{ id: "a", title: "Alpha", cid: "bafyA", updatedAt: 5 }],
    });
  });

  it("never throws and warns instead when listNotes or publishShared fails", () => {
    listNotes.mockImplementation(() => {
      throw new Error("boom");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => publishNoteDocIndex()).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    expect(publishShared).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe("schedulePublishNoteDocIndex", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("coalesces a burst of calls into a single publish after the debounce window", () => {
    listNotes.mockReturnValue([makeNote("a")]);

    schedulePublishNoteDocIndex();
    schedulePublishNoteDocIndex();
    schedulePublishNoteDocIndex();

    expect(publishShared).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(publishShared).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(publishShared).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("restarts the debounce window on each call (trailing debounce)", () => {
    listNotes.mockReturnValue([makeNote("a")]);

    schedulePublishNoteDocIndex();
    vi.advanceTimersByTime(700);
    schedulePublishNoteDocIndex(); // resets the timer before it would have fired
    vi.advanceTimersByTime(700);
    expect(publishShared).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(publishShared).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});

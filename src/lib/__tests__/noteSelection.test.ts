import { describe, expect, it } from "vitest";
import {
  applyNoteRowClick,
  EMPTY_NOTE_SELECTION,
  noteDragIds,
  pruneNoteSelection,
  type NoteSelectionState,
} from "../noteSelection";

const LIST = "unfiled";
const IDS = ["a", "b", "c", "d", "e"];

type Mods = { shift?: boolean; toggle?: boolean };

// Clicks `id` in the default list and returns both the next state and whether
// the note should open, so tests read like the interaction they describe.
function click(state: NoteSelectionState, id: string, mods: Mods = {}, listId = LIST, ids = IDS) {
  return applyNoteRowClick(state, {
    listId,
    orderedIds: ids,
    id,
    shiftKey: mods.shift ?? false,
    toggleKey: mods.toggle ?? false,
  });
}

function selected(state: NoteSelectionState): string[] {
  return [...state.ids].sort();
}

describe("applyNoteRowClick", () => {
  it("opens the note and collapses the selection on a plain click", () => {
    const first = click(EMPTY_NOTE_SELECTION, "b", { toggle: true }).state;
    const result = click(first, "d");
    expect(result.open).toBe(true);
    expect(selected(result.state)).toEqual(["d"]);
    expect(result.state.anchor).toEqual({ listId: LIST, id: "d" });
  });

  it("selects the range between the anchor and a Shift+click, without opening", () => {
    const anchored = click(EMPTY_NOTE_SELECTION, "b").state;
    const result = click(anchored, "d", { shift: true });
    expect(result.open).toBe(false);
    expect(selected(result.state)).toEqual(["b", "c", "d"]);
  });

  it("selects the same range when Shift+clicking upwards", () => {
    const anchored = click(EMPTY_NOTE_SELECTION, "d").state;
    expect(selected(click(anchored, "b", { shift: true }).state)).toEqual(["b", "c", "d"]);
  });

  it("keeps the anchor fixed so a second Shift+click re-measures, not extends", () => {
    const anchored = click(EMPTY_NOTE_SELECTION, "b").state;
    const wide = click(anchored, "e", { shift: true }).state;
    expect(selected(wide)).toEqual(["b", "c", "d", "e"]);
    // Sweeping back toward the anchor shrinks the range rather than leaving
    // the far end selected.
    expect(selected(click(wide, "c", { shift: true }).state)).toEqual(["b", "c"]);
  });

  it("replaces the previous selection on a plain Shift+click", () => {
    const state: NoteSelectionState = { ids: new Set(["a"]), anchor: { listId: LIST, id: "c" } };
    expect(selected(click(state, "d", { shift: true }).state)).toEqual(["c", "d"]);
  });

  it("adds the range to the existing selection on Ctrl+Shift+click", () => {
    const state: NoteSelectionState = { ids: new Set(["a"]), anchor: { listId: LIST, id: "c" } };
    expect(selected(click(state, "d", { shift: true, toggle: true }).state)).toEqual([
      "a",
      "c",
      "d",
    ]);
  });

  it("starts a fresh anchor when Shift+clicking in a different list", () => {
    const anchored = click(EMPTY_NOTE_SELECTION, "b").state;
    const result = click(anchored, "y", { shift: true }, "folder:1", ["x", "y", "z"]);
    expect(result.open).toBe(false);
    expect(selected(result.state)).toEqual(["y"]);
    expect(result.state.anchor).toEqual({ listId: "folder:1", id: "y" });
  });

  it("starts a fresh anchor when the anchored row is no longer in the list", () => {
    const state: NoteSelectionState = { ids: new Set(["a"]), anchor: { listId: LIST, id: "gone" } };
    expect(selected(click(state, "c", { shift: true }).state)).toEqual(["c"]);
  });

  it("toggles one row on Ctrl/Cmd+click, leaving the rest alone", () => {
    const two = click(click(EMPTY_NOTE_SELECTION, "a").state, "c", { toggle: true }).state;
    expect(selected(two)).toEqual(["a", "c"]);
    const result = click(two, "a", { toggle: true });
    expect(result.open).toBe(false);
    expect(selected(result.state)).toEqual(["c"]);
  });
});

describe("noteDragIds", () => {
  const state: NoteSelectionState = { ids: new Set(["a", "b"]), anchor: null };

  it("carries the whole selection when the dragged row is part of it", () => {
    expect(noteDragIds(state, "a").sort()).toEqual(["a", "b"]);
  });

  it("carries only the dragged row when it isn't selected", () => {
    expect(noteDragIds(state, "z")).toEqual(["z"]);
  });

  it("carries only the dragged row for a single-row selection", () => {
    expect(noteDragIds({ ids: new Set(["a"]), anchor: null }, "a")).toEqual(["a"]);
  });
});

describe("pruneNoteSelection", () => {
  it("returns the same object when nothing is stale", () => {
    const state: NoteSelectionState = { ids: new Set(["a"]), anchor: { listId: LIST, id: "a" } };
    expect(pruneNoteSelection(state, new Set(["a", "b"]))).toBe(state);
  });

  it("drops ids and an anchor that no longer exist", () => {
    const state: NoteSelectionState = { ids: new Set(["a", "b"]), anchor: { listId: LIST, id: "b" } };
    const pruned = pruneNoteSelection(state, new Set(["a"]));
    expect(selected(pruned)).toEqual(["a"]);
    expect(pruned.anchor).toBeNull();
  });
});

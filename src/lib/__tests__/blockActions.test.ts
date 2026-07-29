// createBlockActions closes over a plain state object rather than React
// hooks, so the test harness just re-implements that state shape with a
// mutable object and records what the setters were called with — no
// rendering or mocking framework needed.
import { describe, it, expect } from "vitest";
import { createBlockActions, pendingBlockCaret } from "../blockActions";
import { joinBlocks } from "../blocks";

function makeHarness(initialBlocks: string[]) {
  const state = {
    content: joinBlocks(initialBlocks),
    blocksSnapshot: initialBlocks.slice(),
    activeBlockIndex: null as number | null,
  };

  const actionState = {
    get content() {
      return state.content;
    },
    get blocksSnapshot() {
      return state.blocksSnapshot;
    },
    get activeBlockIndex() {
      return state.activeBlockIndex;
    },
    setBlocksSnapshot: (b: string[]) => {
      state.blocksSnapshot = b;
    },
    setContent: (c: string) => {
      state.content = c;
    },
    setActiveBlockIndex: (i: number | null) => {
      state.activeBlockIndex = i;
    },
  };

  const actions = createBlockActions(actionState);
  return { state, actions };
}

describe("addBlockAtEnd", () => {
  it("appends an empty block and focuses it", () => {
    const { state, actions } = makeHarness(["a", "b"]);
    actions.addBlockAtEnd();
    expect(state.blocksSnapshot).toEqual(["a", "b", ""]);
    expect(state.activeBlockIndex).toBe(2);
  });
});

describe("deactivateBlock", () => {
  it("clears the active block and prunes stray empty blocks", () => {
    const { state, actions } = makeHarness(["a", "", "b"]);
    state.activeBlockIndex = 0;
    actions.deactivateBlock();
    expect(state.blocksSnapshot).toEqual(["a", "b"]);
    expect(state.activeBlockIndex).toBeNull();
  });

  it("falls back to a single empty block when everything was empty", () => {
    const { state, actions } = makeHarness(["", ""]);
    actions.deactivateBlock();
    expect(state.blocksSnapshot).toEqual([""]);
  });

  // The prune renumbers blocks. A click moving focus to another block was
  // captured against the pre-prune indices, so pruning mid-hand-off would
  // activate the wrong block (or drop the clicked empty block outright).
  it("skips the prune when focus is handing off to another block", () => {
    const { state, actions } = makeHarness(["a", "", "b"]);
    state.activeBlockIndex = 0;
    actions.deactivateBlock({ skipPrune: true });
    expect(state.blocksSnapshot).toEqual(["a", "", "b"]);
    expect(state.activeBlockIndex).toBeNull();
  });
});

describe("splitBlockAtCursor", () => {
  it("splits the block at the cursor and focuses the second half", () => {
    const { state, actions } = makeHarness(["ab", "c"]);
    actions.splitBlockAtCursor(0, 1);
    expect(state.blocksSnapshot).toEqual(["a", "b", "c"]);
    expect(state.activeBlockIndex).toBe(1);
  });

  it("puts the caret at the start of the new block, not its end", () => {
    const { actions } = makeHarness(["hello world", "c"]);
    pendingBlockCaret.target = null;
    actions.splitBlockAtCursor(0, 5);
    expect(pendingBlockCaret.target).toEqual({ index: 1, caret: 0 });
  });
});

describe("splitBlockAtCursor — paste reflow", () => {
  it("splices a multi-paragraph paste across the block model and focuses the last", () => {
    const { state, actions } = makeHarness(["intro", "tail"]);
    pendingBlockCaret.target = null;
    actions.splitBlockAtCursor(0, 5, { text: "a\n\nb\n\nc", caretEnd: 5, splitIntoBlocks: true });
    expect(state.blocksSnapshot).toEqual(["introa", "b", "c", "tail"]);
    expect(state.activeBlockIndex).toBe(2);
    expect(state.content).toBe(joinBlocks(["introa", "b", "c", "tail"]));
  });

  it("records the caret target for the block that will activate", () => {
    const { actions } = makeHarness(["intro", "tail"]);
    pendingBlockCaret.target = null;
    actions.splitBlockAtCursor(0, 5, { text: "a\n\nbb", caretEnd: 5, splitIntoBlocks: true });
    expect(pendingBlockCaret.target).toEqual({ index: 1, caret: 2 });
  });
});

describe("mergeIntoPrevious", () => {
  it("merges the block into the end of the previous one and focuses it", () => {
    const { state, actions } = makeHarness(["a", "b", "c"]);
    actions.mergeIntoPrevious(1);
    expect(state.blocksSnapshot).toEqual(["ab", "c"]);
    expect(state.activeBlockIndex).toBe(0);
  });

  it("is a no-op for the first block", () => {
    const { state, actions } = makeHarness(["a", "b"]);
    actions.mergeIntoPrevious(0);
    expect(state.blocksSnapshot).toEqual(["a", "b"]);
    expect(state.activeBlockIndex).toBeNull();
  });

  it("puts the caret at the merge boundary, not the end of the merged text", () => {
    const { actions } = makeHarness(["hello", "world"]);
    pendingBlockCaret.target = null;
    actions.mergeIntoPrevious(1);
    expect(pendingBlockCaret.target).toEqual({ index: 0, caret: 5 });
  });
});

describe("focusAdjacentBlock", () => {
  it("moves down into the next block's first line, holding the column", () => {
    const { state, actions } = makeHarness(["abcdef", "ghijkl"]);
    pendingBlockCaret.target = null;
    expect(actions.focusAdjacentBlock(0, 1, 3)).toBe(true);
    expect(state.activeBlockIndex).toBe(1);
    expect(pendingBlockCaret.target).toEqual({ index: 1, caret: 3 });
  });

  it("moves up into the previous block's *last* line, holding the column", () => {
    const { state, actions } = makeHarness(["one\ntwo\nthree", "x"]);
    pendingBlockCaret.target = null;
    expect(actions.focusAdjacentBlock(1, -1, 2)).toBe(true);
    expect(state.activeBlockIndex).toBe(0);
    // "one\ntwo\n" is 8 chars, so column 2 of "three" is offset 10.
    expect(pendingBlockCaret.target).toEqual({ index: 0, caret: 10 });
  });

  it("clamps the column to the length of the line it lands on", () => {
    const { actions } = makeHarness(["abcdefghij", "xy"]);
    pendingBlockCaret.target = null;
    actions.focusAdjacentBlock(0, 1, 8);
    expect(pendingBlockCaret.target).toEqual({ index: 1, caret: 2 });
  });

  it("lands at 0 when the adjacent block is empty", () => {
    const { actions } = makeHarness(["abc", ""]);
    pendingBlockCaret.target = null;
    actions.focusAdjacentBlock(0, 1, 3);
    expect(pendingBlockCaret.target).toEqual({ index: 1, caret: 0 });
  });

  // Returning false lets CodeMirror fall back to its own start/end-of-doc move.
  it("returns false at the first block moving up and the last moving down", () => {
    const { state, actions } = makeHarness(["a", "b"]);
    expect(actions.focusAdjacentBlock(0, -1, 0)).toBe(false);
    expect(actions.focusAdjacentBlock(1, 1, 0)).toBe(false);
    expect(state.activeBlockIndex).toBeNull();
  });
});

describe("insertBlockAfter", () => {
  it("inserts the scaffold immediately after the given index", () => {
    const { state, actions } = makeHarness(["a", "b", "c"]);
    actions.insertBlockAfter(0, "new");
    expect(state.blocksSnapshot).toEqual(["a", "new", "b", "c"]);
    expect(state.content).toBe(joinBlocks(["a", "new", "b", "c"]));
  });

  it("focuses the newly inserted block by default", () => {
    const { state, actions } = makeHarness(["a", "b"]);
    actions.insertBlockAfter(0, "new");
    expect(state.activeBlockIndex).toBe(1);
  });

  it("leaves nothing focused when focus=false (e.g. table/mermaid/hr scaffolds)", () => {
    const { state, actions } = makeHarness(["a", "b"]);
    actions.insertBlockAfter(0, "| a |\n| --- |\n| 1 |", false);
    expect(state.activeBlockIndex).toBeNull();
  });

  it("inserts at the end when index is the last block", () => {
    const { state, actions } = makeHarness(["a", "b"]);
    actions.insertBlockAfter(1, "new");
    expect(state.blocksSnapshot).toEqual(["a", "b", "new"]);
    expect(state.activeBlockIndex).toBe(2);
  });

  it("inserts at the start when index is -1", () => {
    const { state, actions } = makeHarness(["a", "b"]);
    actions.insertBlockAfter(-1, "new");
    expect(state.blocksSnapshot).toEqual(["new", "a", "b"]);
  });
});

describe("removeBlocks", () => {
  it("removes a single index", () => {
    const { state, actions } = makeHarness(["a", "b", "c"]);
    actions.removeBlocks([1]);
    expect(state.blocksSnapshot).toEqual(["a", "c"]);
    expect(state.content).toBe(joinBlocks(["a", "c"]));
  });

  it("removes multiple non-contiguous indices in one call", () => {
    const { state, actions } = makeHarness(["a", "b", "c", "d"]);
    actions.removeBlocks([0, 2]);
    expect(state.blocksSnapshot).toEqual(["b", "d"]);
  });

  it("falls back to a single empty block when everything is removed", () => {
    const { state, actions } = makeHarness(["a", "b"]);
    actions.removeBlocks([0, 1]);
    expect(state.blocksSnapshot).toEqual([""]);
    expect(state.content).toBe("");
  });

  it("is a no-op for an empty indices list", () => {
    const { state, actions } = makeHarness(["a", "b"]);
    actions.removeBlocks([]);
    expect(state.blocksSnapshot).toEqual(["a", "b"]);
  });

  it("ignores out-of-range indices without throwing", () => {
    const { state, actions } = makeHarness(["a", "b"]);
    expect(() => actions.removeBlocks([5, -1])).not.toThrow();
    expect(state.blocksSnapshot).toEqual(["a", "b"]);
  });

  it("tolerates duplicate indices", () => {
    const { state, actions } = makeHarness(["a", "b", "c"]);
    actions.removeBlocks([1, 1]);
    expect(state.blocksSnapshot).toEqual(["a", "c"]);
  });
});

describe("reorderBlock", () => {
  it("is a no-op when from === to", () => {
    const { state, actions } = makeHarness(["a", "b", "c"]);
    actions.reorderBlock(1, 1);
    expect(state.blocksSnapshot).toEqual(["a", "b", "c"]);
  });

  it("moves a block down", () => {
    const { state, actions } = makeHarness(["a", "b", "c", "d"]);
    // Move "a" (index 0) to just past "c" — dropping in "c"'s bottom half
    // means the target index (pre-removal) is 3.
    actions.reorderBlock(0, 3);
    expect(state.blocksSnapshot).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a block up", () => {
    const { state, actions } = makeHarness(["a", "b", "c", "d"]);
    // Move "d" (index 3) to before "b" (target index 1).
    actions.reorderBlock(3, 1);
    expect(state.blocksSnapshot).toEqual(["a", "d", "b", "c"]);
  });

  it("keeps the moved block active — activeBlockIndex follows it to insertAt (moving down)", () => {
    const { state, actions } = makeHarness(["a", "b", "c", "d"]);
    state.activeBlockIndex = 0;
    actions.reorderBlock(0, 3);
    expect(state.blocksSnapshot).toEqual(["b", "c", "a", "d"]);
    expect(state.activeBlockIndex).toBe(2);
  });

  it("keeps the moved block active — activeBlockIndex follows it to insertAt (moving up)", () => {
    const { state, actions } = makeHarness(["a", "b", "c", "d"]);
    state.activeBlockIndex = 3;
    actions.reorderBlock(3, 1);
    expect(state.blocksSnapshot).toEqual(["a", "d", "b", "c"]);
    expect(state.activeBlockIndex).toBe(1);
  });

  it("shifts the active index down by one when another block moves forward across it", () => {
    const { state, actions } = makeHarness(["a", "b", "c", "d"]);
    // Active block is "b" (index 1); moving "a" (index 0) to past "c"
    // (target 3) shifts everything between down by one, so "b" is now at 0.
    state.activeBlockIndex = 1;
    actions.reorderBlock(0, 3);
    expect(state.blocksSnapshot).toEqual(["b", "c", "a", "d"]);
    expect(state.activeBlockIndex).toBe(0);
  });

  it("shifts the active index up by one when another block moves backward across it", () => {
    const { state, actions } = makeHarness(["a", "b", "c", "d"]);
    // Active block is "c" (index 2); moving "d" (index 3) to before "b"
    // (target 1) shifts everything between up by one, so "c" is now at 3.
    state.activeBlockIndex = 2;
    actions.reorderBlock(3, 1);
    expect(state.blocksSnapshot).toEqual(["a", "d", "b", "c"]);
    expect(state.activeBlockIndex).toBe(3);
  });

  it("leaves activeBlockIndex untouched when the move doesn't cross it", () => {
    const { state, actions } = makeHarness(["a", "b", "c", "d"]);
    // Active block is "d" (index 3); moving "a" to before "c" doesn't
    // involve index 3 at all.
    state.activeBlockIndex = 3;
    actions.reorderBlock(0, 2);
    expect(state.blocksSnapshot).toEqual(["b", "a", "c", "d"]);
    expect(state.activeBlockIndex).toBe(3);
  });

  it("stays null when nothing is active", () => {
    const { state, actions } = makeHarness(["a", "b", "c", "d"]);
    expect(state.activeBlockIndex).toBeNull();
    actions.reorderBlock(0, 3);
    expect(state.blocksSnapshot).toEqual(["b", "c", "a", "d"]);
    expect(state.activeBlockIndex).toBeNull();
  });

  it("updates content to match the reordered blocks", () => {
    const { state, actions } = makeHarness(["a", "b", "c"]);
    actions.reorderBlock(0, 2);
    expect(state.content).toBe(joinBlocks(state.blocksSnapshot));
  });
});

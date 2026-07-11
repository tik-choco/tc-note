import { insertPasteAtCursor, joinBlocks, splitBlocks, type PastePayload } from "./blocks";

// Cross-block caret hand-off for a multi-block paste. The block that ends up
// active after the reflow is a *different* editor instance than the one the
// paste event fired on, so its caret can't be positioned inline — splitBlockAtCursor
// records the target (block index + offset) here and LivePreviewEditor consumes
// it once as it activates (see LivePreviewEditor.tsx).
export const pasteCaret: { target: { index: number; caret: number } | null } = { target: null };

// Builds the handlers the block editor needs (edit/activate/jump), closed
// over the current block state. Plain closures rather than a hook — nothing
// here holds its own React state.
//
// Focus hand-off between blocks (split/merge/insert) needs no stray-blur
// bookkeeping: LivePreviewEditor ignores the native blur it emits while being
// unmounted, so `deactivateBlock` only ever runs for a genuine click-away.
export function createBlockActions(state: {
  content: string;
  blocksSnapshot: string[];
  activeBlockIndex: number | null;
  setBlocksSnapshot: (b: string[]) => void;
  setContent: (c: string) => void;
  setActiveBlockIndex: (i: number | null) => void;
}) {
  const { blocksSnapshot, setBlocksSnapshot, setContent, setActiveBlockIndex } = state;

  function updateBlock(index: number, value: string) {
    const next = blocksSnapshot.slice();
    next[index] = value;
    setBlocksSnapshot(next);
    setContent(joinBlocks(next));
  }

  function deactivateBlock() {
    setActiveBlockIndex(null);
    // Re-derive block boundaries from the current blocksSnapshot (merges/
    // creates blocks based on blank lines typed while editing) and drop
    // stray empty blocks so the note doesn't accumulate clutter. Rebuilt
    // from blocksSnapshot rather than `content` so a remote collab update
    // that only touched blocksSnapshot isn't undone by this blur — see
    // applyDocToLocalState in useCollab.ts, which now keeps both in sync,
    // but this avoids relying on that invariant holding everywhere.
    const fresh = splitBlocks(joinBlocks(state.blocksSnapshot)).filter((b) => b.trim() !== "");
    setBlocksSnapshot(fresh.length ? fresh : [""]);
  }

  function addBlockAtEnd() {
    const next = [...blocksSnapshot, ""];
    setBlocksSnapshot(next);
    setActiveBlockIndex(next.length - 1);
  }

  // Splits the block at `index` into two at the cursor position, and
  // activates the new (second) block — Enter-to-continue.
  //
  // With a `paste` payload it instead performs a multi-block paste reflow: the
  // pasted text is segmented (blank-line paragraphs / fenced code) and spliced
  // across the model via insertPasteAtCursor, focusing the block that holds the
  // end of the paste. Routed through this same action (rather than a new prop)
  // because a paste is a generalized split-and-insert. Only called for pastes
  // that actually span multiple blocks — single-block/raw pastes are applied
  // inline inside LivePreviewEditor.
  function splitBlockAtCursor(index: number, cursor: number, paste?: PastePayload) {
    if (paste) {
      const result = insertPasteAtCursor(blocksSnapshot, index, cursor, paste.caretEnd, paste.text, {
        splitIntoBlocks: paste.splitIntoBlocks,
      });
      setBlocksSnapshot(result.blocks);
      setContent(joinBlocks(result.blocks));
      // Hand the caret offset to the block that's about to activate.
      pasteCaret.target = { index: result.activeIndex, caret: result.caret };
      setActiveBlockIndex(result.activeIndex);
      return;
    }
    const block = blocksSnapshot[index];
    const before = block.slice(0, cursor);
    const after = block.slice(cursor);
    const next = blocksSnapshot.slice();
    next.splice(index, 1, before, after);
    setBlocksSnapshot(next);
    setContent(joinBlocks(next));
    setActiveBlockIndex(index + 1);
  }

  // Backspace at the very start of a block merges it into the end of the
  // previous block. No-op for the first block.
  function mergeIntoPrevious(index: number) {
    if (index === 0) return;
    const prev = blocksSnapshot[index - 1];
    const current = blocksSnapshot[index];
    const next = blocksSnapshot.slice();
    next.splice(index - 1, 2, prev + current);
    setBlocksSnapshot(next);
    setContent(joinBlocks(next));
    setActiveBlockIndex(index - 1);
  }

  // Inserts one or more new blocks right after `index`, in order. `focus`
  // opens the first inserted block for text editing immediately; pass false
  // for blocks that render their own UI in view mode (table, mermaid, hr,
  // dropped files) so they show that UI right away instead of raw markdown.
  function insertBlocksAfter(index: number, scaffolds: string[], focus: boolean) {
    if (scaffolds.length === 0) return;
    const next = blocksSnapshot.slice();
    next.splice(index + 1, 0, ...scaffolds);
    setBlocksSnapshot(next);
    setContent(joinBlocks(next));
    setActiveBlockIndex(focus ? index + 1 : null);
  }

  function insertBlockAfter(index: number, scaffold: string, focus = true) {
    insertBlocksAfter(index, [scaffold], focus);
  }

  // Removes the given block indices (used by block-selection delete/cut).
  function removeBlocks(indices: number[]) {
    const toRemove = new Set(indices);
    const next = blocksSnapshot.filter((_, i) => !toRemove.has(i));
    const fresh = next.length ? next : [""];
    setBlocksSnapshot(fresh);
    setContent(joinBlocks(fresh));
  }

  // Moves the block at `from` to sit at position `to` (drag-and-drop
  // reordering). `to` is expressed in terms of the array *before* the move —
  // i.e. "insert before the block currently at index `to`" — so when moving
  // a block forward we need to shift the target down by one to account for
  // the removal that happens first.
  function reorderBlock(from: number, to: number) {
    if (from === to) return;
    const next = blocksSnapshot.slice();
    const [moved] = next.splice(from, 1);
    const insertAt = from < to ? to - 1 : to;
    next.splice(insertAt, 0, moved);
    setBlocksSnapshot(next);
    setContent(joinBlocks(next));
    const active = state.activeBlockIndex;
    if (active !== null) {
      if (active === from) {
        setActiveBlockIndex(insertAt);
      } else {
        let mapped = active;
        if (from < active && insertAt >= active) mapped -= 1;
        else if (from > active && insertAt <= active) mapped += 1;
        if (mapped !== active) setActiveBlockIndex(mapped);
      }
    }
  }

  function jumpToOffset(offset: number) {
    // Find which block that offset falls into and activate it for editing.
    let consumed = 0;
    for (let i = 0; i < blocksSnapshot.length; i++) {
      const len = blocksSnapshot[i].length;
      if (offset <= consumed + len || i === blocksSnapshot.length - 1) {
        setActiveBlockIndex(i);
        return;
      }
      consumed += len + 2; // account for the "\n\n" separator
    }
  }

  return {
    updateBlock,
    deactivateBlock,
    addBlockAtEnd,
    splitBlockAtCursor,
    mergeIntoPrevious,
    insertBlockAfter,
    insertBlocksAfter,
    removeBlocks,
    reorderBlock,
    jumpToOffset,
  };
}

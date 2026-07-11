// Assigns stable ids to a plain string[] of blocks across edits, so the
// collab layer can store each block under its own Yjs map key instead of
// replacing the whole list on every keystroke (which would blow away
// concurrent edits to other blocks — see collab.ts) — and computes the
// minimal set of Yjs writes needed to move the doc from the old shape to
// the new one, so two peers making structural edits at the same time don't
// interleave into duplicated blocks either.
//
// The common case (typing into a block) never changes the block count, so
// it's handled as a pure positional update: ids are kept, only the content
// at the edited index differs. Structural edits (split/merge/add/delete)
// change the count, so positions are no longer meaningful; those are
// reconciled by finding the longest common subsequence of block *values*
// between the old and new list, matching unchanged blocks by identity and
// minting fresh ids only for blocks that are genuinely new.

export type OrderOp =
  | { type: "delete"; index: number; count: number }
  | { type: "insert"; index: number; ids: string[] };

export interface BlockReconciliation {
  ids: string[];
  /** ids present before this change that are no longer present after it — safe to drop from the content map. */
  removedIds: string[];
  /** exact (id, value) pairs that need writing to the content map. */
  contentWrites: { id: string; value: string }[];
  /** positional insert/delete ops that replay the old order array into the new one, in order. */
  orderOps: OrderOp[];
}

export function reconcileBlockIds(
  prevIds: string[],
  prevValues: string[],
  nextValues: string[],
  makeId: () => string,
): BlockReconciliation {
  if (prevValues.length === nextValues.length) {
    // Same block count: assume index-stable positions (this is what every
    // editing operation in blockActions.ts that preserves length does), so
    // only the indices whose content actually changed need writing.
    const contentWrites: { id: string; value: string }[] = [];
    for (let i = 0; i < nextValues.length; i++) {
      if (nextValues[i] !== prevValues[i]) {
        contentWrites.push({ id: prevIds[i], value: nextValues[i] });
      }
    }
    return { ids: prevIds, removedIds: [], contentWrites, orderOps: [] };
  }
  return lcsReconcile(prevIds, prevValues, nextValues, makeId);
}

// Longest-common-subsequence match on block content, back-tracked into a
// keep/insert/delete script, then compressed into positional order ops.
// Blocks are typically few dozen at most, so the O(n*m) DP table is cheap.
function lcsReconcile(
  prevIds: string[],
  prevValues: string[],
  nextValues: string[],
  makeId: () => string,
): BlockReconciliation {
  const n = prevValues.length;
  const m = nextValues.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        prevValues[i] === nextValues[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const nextIds: string[] = [];
  const matchedPrevIndices = new Set<number>();
  const contentWrites: { id: string; value: string }[] = [];
  const script: Array<"keep" | "delete" | "insert"> = [];

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (prevValues[i] === nextValues[j] && dp[i][j] === dp[i + 1][j + 1] + 1) {
      nextIds.push(prevIds[i]);
      matchedPrevIndices.add(i);
      script.push("keep");
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      script.push("delete");
      i++;
    } else {
      const id = makeId();
      nextIds.push(id);
      contentWrites.push({ id, value: nextValues[j] });
      script.push("insert");
      j++;
    }
  }
  while (i < n) {
    script.push("delete");
    i++;
  }
  while (j < m) {
    const id = makeId();
    nextIds.push(id);
    contentWrites.push({ id, value: nextValues[j] });
    script.push("insert");
    j++;
  }

  // Compress the script into positional ops: `pos` tracks where we are in
  // the order array *as it's being transformed*, so deletes and inserts
  // land at the right place regardless of how earlier ops already shifted
  // things (the same idea as applying a text diff as an edit script).
  const orderOps: OrderOp[] = [];
  let pos = 0;
  let k = 0;
  let nextIdx = 0;
  while (k < script.length) {
    const kind = script[k];
    if (kind === "keep") {
      pos++;
      nextIdx++;
      k++;
      continue;
    }
    if (kind === "delete") {
      let count = 0;
      while (k < script.length && script[k] === "delete") {
        count++;
        k++;
      }
      orderOps.push({ type: "delete", index: pos, count });
      continue;
    }
    // insert run
    const ids: string[] = [];
    while (k < script.length && script[k] === "insert") {
      ids.push(nextIds[nextIdx]);
      nextIdx++;
      k++;
    }
    orderOps.push({ type: "insert", index: pos, ids });
    pos += ids.length;
  }

  const removedIds = prevIds.filter((_, idx) => !matchedPrevIndices.has(idx));
  return { ids: nextIds, removedIds, contentWrites, orderOps };
}

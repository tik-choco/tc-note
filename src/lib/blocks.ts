// Splits markdown into block-level chunks on blank lines, while keeping
// fenced code blocks and own-line $$ display-math fences intact (a blank line
// inside either fence must not split the block). Each block renders
// independently via marked when not being edited.
export function splitBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false; // ``` code fence
  let inMath = false;  // $$ display-math fence (own-line delimiter form)

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      // A ``` inside an open $$ block is literal, not a code fence.
      if (!inMath) inFence = !inFence;
    } else if (trimmed === "$$" && !inFence) {
      // A line that is exactly `$$` opens/closes a display-math block. Keeping
      // it atomic (like a code fence) means a blank line inside the math -- an
      // aligned environment, or the empty middle line of the `$$` insert
      // scaffold -- doesn't split it into two broken halves.
      inMath = !inMath;
    }

    if (!inFence && !inMath && trimmed === "") {
      if (current.length) {
        blocks.push(current.join("\n"));
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));

  return blocks.length ? blocks : [""];
}

// True when the caret (given only the text before it) sits inside an unclosed
// `$$` display-math block -- an odd number of own-line `$$` delimiters precede
// it. Block.tsx uses this so a plain Enter inside display math inserts a
// newline (growing the block) instead of splitting it, mirroring list lines.
export function isInsideOpenMathFence(before: string): boolean {
  let open = false;
  for (const line of before.split("\n")) {
    if (line.trim() === "$$") open = !open;
  }
  return open;
}

export function joinBlocks(blocks: string[]): string {
  return blocks.join("\n\n");
}

// Data an onPaste handler forwards to the block-model reflow when a paste
// spans more than one block (see insertPasteAtCursor / splitBlockAtCursor).
export interface PastePayload {
  /** The clipboard's text/plain payload, verbatim (line endings normalized later). */
  text: string;
  /** Selection end at paste time — with caretStart this is the range the paste replaces. */
  caretEnd: number;
  /** false = raw single-block insert (Ctrl+Shift+V); true = auto-split on blank lines. */
  splitIntoBlocks: boolean;
}

export interface InsertPasteResult {
  /** The full block list after the paste. */
  blocks: string[];
  /** Block that should be focused afterwards (the one holding the end of the paste). */
  activeIndex: number;
  /** Caret offset within that block, at the end of the inserted content. */
  caret: number;
}

// Pure core of the paste feature: inserts `pastedText` into `blocks[blockIndex]`
// at the caret (replacing the [caretStart, caretEnd) selection), returning the
// new block list plus where to put the caret. Deterministic and DOM-free so it
// can be unit-tested directly.
//
// With splitIntoBlocks:false it is a literal single-block insert (raw paste).
// With splitIntoBlocks:true the pasted text is segmented with the app's own
// block rules (splitBlocks — blank-line paragraphs split, fenced ``` code stays
// whole): the text before the caret + the first segment stay in the current
// block, middle segments become new blocks, and the last segment + the text
// after the caret form the final block.
export function insertPasteAtCursor(
  blocks: string[],
  blockIndex: number,
  caretStart: number,
  caretEnd: number,
  pastedText: string,
  options: { splitIntoBlocks: boolean },
): InsertPasteResult {
  const safeIndex = Math.max(0, Math.min(blockIndex, blocks.length - 1));
  const block = blocks[safeIndex] ?? "";
  // Tolerate a reversed or out-of-range selection.
  const lo = Math.max(0, Math.min(caretStart, caretEnd, block.length));
  const hi = Math.min(Math.max(caretStart, caretEnd, lo), block.length);
  const before = block.slice(0, lo);
  const after = block.slice(hi);

  // Clipboard text can carry CRLF or lone CR; normalize so no stray \r leaks
  // into the model (it would corrupt fence detection and rendering).
  const text = pastedText.replace(/\r\n?/g, "\n");

  const inline = (value: string, caret: number): InsertPasteResult => {
    const next = blocks.slice();
    next[safeIndex] = value;
    return { blocks: next, activeIndex: safeIndex, caret };
  };

  if (!options.splitIntoBlocks) {
    // Raw paste: literal insert, kept entirely inside the current block.
    return inline(before + text + after, before.length + text.length);
  }

  const segments = splitBlocks(text);
  if (segments.length <= 1) {
    // A single paragraph (or one fenced code block, or blank-only text): stays
    // inline. Use the split result so leading/trailing blank lines are trimmed
    // the same way multi-block pastes are, while intra-block single newlines
    // are preserved.
    const seg = segments[0] ?? "";
    return inline(before + seg + after, before.length + seg.length);
  }

  const first = segments[0];
  const middle = segments.slice(1, -1);
  const last = segments[segments.length - 1];
  const newBlocks = [before + first, ...middle, last + after];

  const next = blocks.slice();
  next.splice(safeIndex, 1, ...newBlocks);
  return {
    blocks: next,
    activeIndex: safeIndex + newBlocks.length - 1,
    caret: last.length,
  };
}

import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { ChangeSpec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { livePreview } from "../lib/cm/livePreview";
import { selectionToolbarWatcher, type ToolbarRect } from "../lib/cm/selectionToolbar";
import {
  applySlashTrigger,
  filterSlashItems,
  slashTriggerWatcher,
  type SlashItem,
  type SlashTrigger,
} from "../lib/cm/slashMenu";
import { insertPasteAtCursor, isInsideOpenMathFence, type PastePayload } from "../lib/blocks";
import { pasteCaret } from "../lib/blockActions";
import { INSERT_OPTIONS, resolveScaffold } from "../lib/blockScaffolds";
import { useT } from "../hooks/useAppSettings";
import { SelectionToolbar } from "./SelectionToolbar";
import { SlashMenu } from "./SlashMenu";

const LIST_LINE = /^\s*([-*+]|\d+\.)\s/;

// Slash-menu commands are the in-place-prefix subset of the "+" insert menu's
// scaffolds (table/mermaid are their own multi-line block templates, not a
// simple prefix swap, so they stay "+"-menu only for now). Reusing
// INSERT_OPTIONS means the labels are already translated in all 8 languages.
const SLASH_KEYS = ["h1", "h2", "h3", "bullet", "numbered", "checklist", "quote", "code", "math", "hr"];
// Caret offset for the two fenced scaffolds — lands on the empty middle line
// ("```\n" / "$$\n") instead of the default end-of-text position.
const SLASH_CARET_OFFSET: Record<string, number> = { code: 4, math: 3 };

// Marker -> {node, mark}: the syntax node a wrap produces, and the name of
// its opening/closing mark children. "*" and "**" both use the character
// "*", so telling them apart by counting raw characters at the selection's
// edges is ambiguous right at the boundary of a longer run (toggling italic
// on a bold-wrapped selection would otherwise nibble one "*" off the bold
// marker instead of nesting). The parser already disambiguates
// StrongEmphasis from Emphasis structurally, so ask it instead.
const WRAP_NODE: Record<string, { node: string; mark: string }> = {
  "**": { node: "StrongEmphasis", mark: "EmphasisMark" },
  "*": { node: "Emphasis", mark: "EmphasisMark" },
  "`": { node: "InlineCode", mark: "CodeMark" },
};

type WrapInfo = { from: number; to: number; contentFrom: number; contentTo: number };

// If [from, to) is exactly the content (or the whole span, marks included)
// of a `marker`-wrapped node, returns that node's outer and inner bounds.
function findWrap(view: EditorView, marker: string, from: number, to: number): WrapInfo | null {
  const spec = WRAP_NODE[marker];
  if (!spec) return null;
  let found: WrapInfo | null = null;
  syntaxTree(view.state).iterate({
    from,
    to,
    enter: (node) => {
      if (found || node.name !== spec.node || node.from > from || node.to < to) return;
      const marks = node.node.getChildren(spec.mark);
      if (marks.length < 2) return;
      const contentFrom = marks[0].to;
      const contentTo = marks[marks.length - 1].from;
      if ((contentFrom === from && contentTo === to) || (node.from === from && node.to === to)) {
        found = { from: node.from, to: node.to, contentFrom, contentTo };
      }
    },
  });
  return found;
}

// Wraps (or unwraps) each selection in an inline marker — "**" for bold, "*"
// for italic, "`" for inline code. An empty selection inserts the pair with
// the caret between them.
function toggleMarker(view: EditorView, marker: string): boolean {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const anchors: { from: number; to: number }[] = [];
  for (const range of state.selection.ranges) {
    const { from, to } = range;
    const wrap = range.empty ? null : findWrap(view, marker, from, to);
    if (wrap) {
      changes.push({ from: wrap.from, to: wrap.contentFrom }, { from: wrap.contentTo, to: wrap.to });
    } else {
      changes.push({ from, insert: marker }, { from: to, insert: marker });
    }
    anchors.push({ from, to });
  }
  // Map each original anchor through the ChangeSet rather than hand-computing
  // an offset shift — insertions and deletions land at different boundaries
  // (an insertion at `from`/`to` needs the selection to end up *outside* the
  // new marker text; the wrap/unwrap branches can also mix per-range within
  // one multi-cursor edit), and mapPos already gets this right.
  const changeSet = state.changes(changes);
  const ranges = anchors.map(({ from, to }) =>
    EditorSelection.range(changeSet.mapPos(from, 1), changeSet.mapPos(to, -1)),
  );
  view.dispatch(
    state.update({
      changes,
      selection: EditorSelection.create(ranges, state.selection.mainIndex),
      scrollIntoView: true,
    }),
  );
  return true;
}

// "#" cycles a line's heading level (body -> h1 -> … -> h6 -> body). Live
// preview hides the "#" markers and the atomic ranges park the caret after
// them, so this is how a heading's level is changed once it's set.
//
// It fires in two cases, and is otherwise a literal "#":
//   • a non-empty selection covering the line start — press "#" to convert /
//     cycle the selected line (the "select then #" flow), or
//   • a collapsed caret at the start of a line that is ALREADY a heading —
//     to bump an existing (marker-hidden) heading's level.
// A collapsed "#" on a plain line stays literal, so typing "# " still creates a
// heading the normal way.
function cycleHeading(view: EditorView): boolean {
  if (view.composing) return false;
  const { state } = view;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const hm = /^(#{1,6})\s+/.exec(line.text);
  const level = hm ? hm[1].length : 0;
  const contentStart = line.from + (hm ? hm[0].length : 0);
  // The atomic hidden markers park a collapsed caret somewhere in [line start,
  // content start] (exactly where varies with the marker width), so accept the
  // whole range rather than an exact offset.
  const act = sel.empty ? level > 0 && sel.head <= contentStart : sel.from <= contentStart;
  if (!act) return false;
  const next = level >= 6 ? 0 : level + 1;
  const prefix = next === 0 ? "" : "#".repeat(next) + " ";
  const delta = prefix.length - (contentStart - line.from);
  const remap = (p: number) => (p >= contentStart ? p + delta : p);
  view.dispatch(
    state.update({
      changes: { from: line.from, to: contentStart, insert: prefix },
      selection: sel.empty
        ? EditorSelection.cursor(remap(sel.head))
        : EditorSelection.range(remap(sel.anchor), remap(sel.head)),
      scrollIntoView: true,
    }),
  );
  return true;
}

// Wraps the current selection as a markdown link, "[selected](" + caret +
// ")" — used by the floating selection toolbar's link button, which only
// shows while a selection is non-empty.
function insertLink(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to);
  const prefix = `[${text}](`;
  view.dispatch(
    state.update({
      changes: { from, to, insert: `${prefix})` },
      selection: EditorSelection.cursor(from + prefix.length),
      scrollIntoView: true,
    }),
  );
  return true;
}

type Props = {
  /** This block's position, used to claim a pending multi-block-paste caret. */
  index: number;
  text: string;
  /** Caret offset requested by the click that activated this block. */
  pendingCaretRef: { current: number | null };
  onChange: (value: string) => void;
  onSplit: (cursor: number, paste?: PastePayload) => void;
  onMergeIntoPrevious: () => void;
  onDeactivate: () => void;
  onEscalateSelectAll?: () => void;
  onExtendBlockSelection?: (direction: 1 | -1) => void;
};

// CodeMirror 6 editing surface for the active block. Same behaviors as the old
// <textarea> (Enter-split, Backspace-merge, list/math newline, paste reflow,
// select-all escalation, cross-block shift-select, IME safety) but rendered as
// live-preview markdown so the syntax markers stay hidden while typing.
export function LivePreviewEditor(props: Props) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Screen position for the floating selection-format toolbar; null hides it
  // (collapsed selection, no selection, or the view was just torn down).
  const [toolbarRect, setToolbarRect] = useState<ToolbarRect>(null);
  // Slash-menu ("/") state: the active trigger + its screen coords, plus
  // which item is highlighted. Filtered items are derived from `trigger`, not
  // stored separately, so they can never drift out of sync with the query.
  const [slash, setSlash] = useState<{ trigger: SlashTrigger; coords: { left: number; top: number } } | null>(null);
  const [slashHighlight, setSlashHighlight] = useState(0);
  const slashItems = useMemo<SlashItem[]>(
    () =>
      INSERT_OPTIONS.filter((opt) => SLASH_KEYS.includes(opt.key)).map((opt) => ({
        key: opt.key,
        label: t(opt.labelKey),
        insertText: resolveScaffold(opt, t),
        caretOffset: SLASH_CARET_OFFSET[opt.key],
      })),
    [t],
  );
  const slashFiltered = slash?.trigger ? filterSlashItems(slashItems, slash.trigger.query) : [];
  // The CM keymap handlers below are created once at mount, so they read the
  // slash-menu's live state through this ref rather than closing over stale
  // state from the render that set up the keymap (same pattern as `cb`).
  const slashRef = useRef({ trigger: slash?.trigger ?? null, items: slashFiltered, highlight: slashHighlight });
  slashRef.current = { trigger: slash?.trigger ?? null, items: slashFiltered, highlight: slashHighlight };

  function confirmSlashItem(view: EditorView): boolean {
    const { trigger, items, highlight } = slashRef.current;
    if (!trigger || items.length === 0) return false;
    const item = items[Math.min(highlight, items.length - 1)];
    applySlashTrigger(view, trigger, item.insertText, item.caretOffset);
    setSlash(null);
    return true;
  }
  // Set just before we tear the editor down, so the native blur that firing
  // `view.destroy()` on a still-focused editor emits (during an Enter-split,
  // Backspace-merge, or collab re-key remount) is NOT mistaken for the user
  // clicking away. Only genuine blurs deactivate the block.
  const destroyingRef = useRef(false);
  // Latest props, read by the long-lived CM handlers so they never close over
  // a stale render.
  const cb = useRef(props);
  cb.current = props;
  // Latched on Mod+Shift+V so the following paste pastes raw (no block split).
  const shiftPasteRef = useRef(false);

  // --- key handlers (read live props via `cb.current`) ---

  function handleEnter(view: EditorView): boolean {
    // Enter during IME composition confirms the conversion — never a split.
    if (view.composing) return false;
    // The slash menu, when open, owns Enter (confirm the highlighted command).
    if (confirmSlashItem(view)) return true;
    const { state } = view;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    // Keep list items and open $$…$$ math within one block: a plain newline.
    if (LIST_LINE.test(line.text) || isInsideOpenMathFence(state.doc.sliceString(0, head))) {
      view.dispatch(state.replaceSelection("\n"));
      return true;
    }
    cb.current.onSplit(head);
    return true;
  }

  // Arrow/Escape only act while the slash menu is open; otherwise they fall
  // through to CodeMirror's normal cursor movement.
  function handleSlashArrow(direction: 1 | -1): boolean {
    const { items } = slashRef.current;
    if (items.length === 0) return false;
    setSlashHighlight((h) => (h + direction + items.length) % items.length);
    return true;
  }

  function handleSlashEscape(): boolean {
    if (!slashRef.current.trigger) return false;
    setSlash(null);
    return true;
  }

  function insertNewline(view: EditorView): boolean {
    if (view.composing) return false;
    view.dispatch(view.state.replaceSelection("\n"));
    return true;
  }

  function handleBackspace(view: EditorView): boolean {
    if (view.composing) return false;
    const m = view.state.selection.main;
    if (m.empty && m.head === 0) {
      cb.current.onMergeIntoPrevious();
      return true;
    }
    return false;
  }

  // "[]" or "[ ]" + space at the start of a line becomes a task list item.
  function handleSpace(view: EditorView): boolean {
    if (view.composing) return false;
    const m = view.state.selection.main;
    if (!m.empty) return false;
    const line = view.state.doc.lineAt(m.head);
    const before = line.text.slice(0, m.head - line.from);
    if (before === "[]" || before === "[ ]") {
      view.dispatch(view.state.update({ changes: { from: line.from, to: m.head, insert: "- [ ] " } }));
      return true;
    }
    return false;
  }

  // First Mod+A selects the block's text (default). A second one, with the
  // whole block already selected, escalates to whole-block selection.
  function handleSelectAll(view: EditorView): boolean {
    const m = view.state.selection.main;
    const len = view.state.doc.length;
    if (len > 0 && m.from === 0 && m.to === len) {
      cb.current.onEscalateSelectAll?.();
      return true;
    }
    return false;
  }

  function handleShiftDown(view: EditorView): boolean {
    if (view.state.selection.main.head === view.state.doc.length) {
      cb.current.onExtendBlockSelection?.(1);
      return true;
    }
    return false;
  }

  function handleShiftUp(view: EditorView): boolean {
    if (view.state.selection.main.head === 0) {
      cb.current.onExtendBlockSelection?.(-1);
      return true;
    }
    return false;
  }

  // Auto-format pastes into the block model (mirrors the old textarea path):
  // default paste splits blank-line paragraphs into blocks; Mod+Shift+V pastes
  // raw into this block only.
  function handlePaste(e: ClipboardEvent, view: EditorView): boolean {
    const data = e.clipboardData;
    if (!data) return false;
    const pasted = data.getData("text/plain");
    if (!pasted) return false;
    e.preventDefault();
    const m = view.state.selection.main;
    const rawMode = shiftPasteRef.current;
    shiftPasteRef.current = false;
    const docText = view.state.doc.toString();
    const result = insertPasteAtCursor([docText], 0, m.from, m.to, pasted, { splitIntoBlocks: !rawMode });
    if (result.blocks.length === 1) {
      const value = result.blocks[0];
      view.dispatch({
        changes: { from: 0, to: docText.length, insert: value },
        selection: { anchor: Math.min(result.caret, value.length) },
      });
      return true;
    }
    cb.current.onSplit(m.from, { text: pasted, caretEnd: m.to, splitIntoBlocks: true });
    return true;
  }

  // Mount the editor once; it lives for as long as this block is active.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Initial caret: a multi-block paste hands its target here; otherwise the
    // click that activated the block, else the end of the text.
    let caret: number;
    const target = pasteCaret.target;
    if (target && target.index === cb.current.index) {
      caret = target.caret;
      pasteCaret.target = null;
    } else {
      caret = cb.current.pendingCaretRef.current ?? cb.current.text.length;
    }
    cb.current.pendingCaretRef.current = null;
    const anchor = Math.min(caret, cb.current.text.length);

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: cb.current.text,
        selection: { anchor },
        extensions: [
          history(),
          markdown({ base: markdownLanguage, extensions: [GFM] }),
          livePreview,
          selectionToolbarWatcher((rect) => setToolbarRect(rect)),
          slashTriggerWatcher((trigger, view) => {
            if (!trigger) {
              setSlash(null);
              return;
            }
            // coordsAtPos needs layout info, which CM forbids reading
            // synchronously from inside a plugin update — defer to a measure
            // pass (same fix as the selection toolbar's crash-and-recover).
            view.requestMeasure({
              key: "slash-menu",
              read: (v) => v.coordsAtPos(trigger.from),
              write: (coords) => {
                setSlash(coords ? { trigger, coords: { left: coords.left, top: coords.bottom + 4 } } : null);
                setSlashHighlight(0);
              },
            });
          }),
          placeholder(t("block.placeholder")),
          EditorView.lineWrapping,
          keymap.of([
            { key: "Enter", run: handleEnter },
            { key: "Shift-Enter", run: insertNewline },
            { key: "Backspace", run: handleBackspace },
            { key: "Space", run: handleSpace },
            { key: "Mod-a", run: handleSelectAll },
            { key: "Mod-b", run: (v) => toggleMarker(v, "**") },
            { key: "Mod-i", run: (v) => toggleMarker(v, "*") },
            { key: "#", run: cycleHeading },
            { key: "ArrowDown", run: () => handleSlashArrow(1) },
            { key: "ArrowUp", run: () => handleSlashArrow(-1) },
            { key: "Escape", run: handleSlashEscape },
            { key: "Shift-ArrowDown", run: handleShiftDown },
            { key: "Shift-ArrowUp", run: handleShiftUp },
          ]),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            blur: () => {
              // Ignore the blur emitted while the editor is being unmounted
              // programmatically — that's a focus hand-off, not a click-away.
              if (destroyingRef.current) return false;
              setToolbarRect(null);
              cb.current.onDeactivate();
              return false;
            },
            keydown: (e) => {
              // The paste event doesn't carry modifiers reliably; latch here.
              if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
                shiftPasteRef.current = e.shiftKey;
              }
              return false;
            },
            paste: handlePaste,
          }),
        ],
      }),
    });
    viewRef.current = view;
    view.focus();

    return () => {
      destroyingRef.current = true;
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile external text changes (e.g. remote collab edits) without
  // clobbering local edits: only touch the doc when it actually diverges.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (props.text !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: props.text },
        selection: { anchor: Math.min(view.state.selection.main.head, props.text.length) },
      });
    }
  }, [props.text]);

  return (
    <>
      <div class="block-cm" ref={hostRef} />
      {toolbarRect && (
        <SelectionToolbar
          rect={toolbarRect}
          onBold={() => viewRef.current && toggleMarker(viewRef.current, "**")}
          onItalic={() => viewRef.current && toggleMarker(viewRef.current, "*")}
          onCode={() => viewRef.current && toggleMarker(viewRef.current, "`")}
          onLink={() => viewRef.current && insertLink(viewRef.current)}
        />
      )}
      {slash && (
        <SlashMenu
          items={slashFiltered}
          highlightedIndex={slashHighlight}
          coords={slash.coords}
          onPick={(item) => {
            const view = viewRef.current;
            if (view && slash.trigger) applySlashTrigger(view, slash.trigger, item.insertText, item.caretOffset);
            setSlash(null);
          }}
          onHighlightChange={setSlashHighlight}
        />
      )}
    </>
  );
}

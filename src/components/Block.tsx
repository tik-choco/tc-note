import { useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js";
import "katex/dist/katex.min.css";
import { TableBlock } from "./TableBlock";
import { MermaidBlock } from "./MermaidBlock";
import { BibtexBlock } from "./BibtexBlock";
import { LivePreviewEditor } from "./LivePreviewEditor";
import { isTableMarkdown } from "../lib/table";
import { isMermaidBlock } from "../lib/mermaidDetect";
import { isBibtexBlock, type BibtexEntry } from "../lib/bibtex";
import type { PastePayload } from "../lib/blocks";
import { useT } from "../hooks/useAppSettings";

const md = new Marked(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  }),
).use(markedKatex({ throwOnError: false }));

// Set by renderBlockHtml just before each md.parse() call, so the bibtexRef
// tokenizer below (registered once, closed over this binding) knows which
// @keys are real citations in the note currently being rendered. marked's
// parse() is synchronous and this module never re-enters it from within a
// tokenizer/renderer callback, so there's no interleaving between
// renderBlockHtml calls -- a module-level mutable is safe here despite
// looking racy at a glance.
let currentCitekeys: Set<string> = new Set();

// Turns a bare "@citekey" into a hoverable reference span, but only when the
// key is actually known (from a ```bibtex block elsewhere in the note) --
// otherwise it's left as plain text so unrelated "@mentions" in prose aren't
// mistaken for citations. Registered as a token extension (rather than a
// post-hoc string replace on the rendered HTML) so it can't accidentally
// match inside tag attributes, URLs, or code spans.
md.use({
  extensions: [
    {
      name: "bibtexRef",
      level: "inline",
      start(src: string) {
        return src.match(/@/)?.index;
      },
      tokenizer(src: string) {
        const match = /^@([a-zA-Z0-9_:-]+)/.exec(src);
        if (!match) return undefined;
        const key = match[1];
        if (!currentCitekeys.has(key)) return undefined;
        return { type: "bibtexRef", raw: match[0], key };
      },
      renderer(token) {
        // `key` can only contain [a-zA-Z0-9_:-] (enforced by the tokenizer's
        // regex above), so it's already safe to inline into both the
        // attribute and text position without further escaping.
        const key = token.key as string;
        return `<span class="bibtex-ref" data-key="${key}" tabindex="0">@${key}</span>`;
      },
    },
  ],
});

// marked renders task-list checkboxes as disabled, which also swallows click
// events — strip that so they can be toggled from the rendered view.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node instanceof HTMLInputElement && node.type === "checkbox") {
    node.removeAttribute("disabled");
  }
});

// Rendering a block runs marked + KaTeX + highlight.js + DOMPurify -- far too
// heavy to redo on every keystroke, since editing one block re-renders every
// other (unchanged) block in a long note. Memoize the parsed HTML by source so
// those re-renders become O(1) lookups; the cached string is referentially
// reused, so Preact also skips the innerHTML write. Bounded (LRU) so a huge
// note, or many notes across a session, can't grow it without limit.
//
// Whether an "@key" renders as a hoverable citation depends on the note's
// whole bibliography (collected from OTHER blocks), not just this block's own
// text -- so the cache key must include the known citekey set too. Without
// this, adding/removing a ```bibtex block would leave every other block's
// "@key" mentions stuck showing whatever was cached before the bibliography
// changed (stale plain text after a matching entry is added, or a stale link
// after its entry is removed).
const RENDER_CACHE_LIMIT = 400;
const renderCache = new Map<string, string>();

function renderBlockHtml(block: string, bibliography: Map<string, BibtexEntry>): string {
  const cacheKey = `${block} ${Array.from(bibliography.keys()).sort().join(",")}`;
  const hit = renderCache.get(cacheKey);
  if (hit !== undefined) {
    // Refresh recency so hot blocks survive eviction.
    renderCache.delete(cacheKey);
    renderCache.set(cacheKey, hit);
    return hit;
  }
  currentCitekeys = new Set(bibliography.keys());
  const html = DOMPurify.sanitize(md.parse(block, { async: false }), {
    // KaTeX emits MathML alongside its HTML fallback; DOMPurify's default HTML
    // profile strips those tags/attrs, so widen it for math output. (The
    // visible math is the .katex-html span layer and survives regardless; this
    // preserves the MathML a11y/copy layer for common constructs too.)
    ADD_TAGS: [
      "math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "ms",
      "mtext", "mspace", "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot",
      "munder", "mover", "munderover", "mtable", "mtr", "mtd", "mpadded",
      "mphantom", "mstyle", "menclose",
    ],
    ADD_ATTR: [
      "mathvariant", "encoding", "display", "displaystyle", "scriptlevel",
      "stretchy", "fence", "accent", "accentunder", "columnalign", "rowspan",
      "columnspacing", "rowspacing", "linethickness", "width", "notation",
    ],
    // DOMPurify allows data-* attributes by default, but the bibtex-ref span's
    // data-key is load-bearing (the hover-card lookup below depends on it) so
    // this is spelled out explicitly rather than relying on the default.
    ALLOW_DATA_ATTR: true,
  });
  renderCache.set(cacheKey, html);
  if (renderCache.size > RENDER_CACHE_LIMIT) {
    const oldest = renderCache.keys().next().value;
    if (oldest !== undefined) renderCache.delete(oldest);
  }
  return html;
}

const EMPTY_BIBLIOGRAPHY: Map<string, BibtexEntry> = new Map();

// Small floating card shown while hovering/focusing a .bibtex-ref span (see
// Block's onMouseOver/onFocus handlers below) -- self-contained since it's
// naturally scoped to a single block's rendered view.
function BibtexHoverCard(props: { entry: BibtexEntry; rect: DOMRect }) {
  const { entry, rect } = props;
  const venue = entry.fields.journal || entry.fields.booktitle;
  const meta = [entry.fields.author, entry.fields.year, venue].filter(Boolean).join(" · ");
  return (
    <div class="bibtex-hover-card" role="tooltip" style={{ top: `${rect.bottom + 6}px`, left: `${rect.left}px` }}>
      <div class="bibtex-hover-card-title">{entry.fields.title || entry.key}</div>
      {meta && <div class="bibtex-hover-card-meta">{meta}</div>}
    </div>
  );
}

const TASK_MARKER = /^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/;

// Flips the checked state of the idx-th task marker in the markdown source.
function toggleNthTask(source: string, idx: number): string {
  let seen = -1;
  return source
    .split("\n")
    .map((line) => {
      const m = line.match(TASK_MARKER);
      if (!m) return line;
      seen += 1;
      if (seen !== idx) return line;
      const flipped = m[2] === " " ? "x" : " ";
      return line.replace(TASK_MARKER, `$1[${flipped}]`);
    })
    .join("\n");
}

// Best-effort mapping from a click inside the rendered HTML back to an
// offset in the markdown source: take the visible text just before the
// caret and look for it in the source, shrinking the needle until it hits.
function sourceOffsetFromClick(container: HTMLElement, source: string, x: number, y: number): number | null {
  let node: Node | null = null;
  let offset = 0;
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  } else if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (!node || !container.contains(node)) return null;

  // Visible text from the start of the block up to the caret.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let prefix = "";
  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    if (cur === node) {
      prefix += (cur.textContent ?? "").slice(0, offset);
      break;
    }
    prefix += cur.textContent ?? "";
  }

  // Rough proportional estimate of where the click should land in the
  // source: markdown syntax characters (**, #, etc.) stretch the source
  // relative to the rendered text, but the mapping is still roughly linear,
  // so this narrows the needle search to the occurrence nearest the click
  // instead of always the first one in the block (which, for short/common
  // needles repeated earlier in the text, put the caret in the wrong spot).
  const totalVisible = container.textContent?.length ?? prefix.length;
  const estimatedPos = totalVisible > 0 ? (prefix.length / totalVisible) * source.length : 0;

  for (const len of [24, 12, 6, 3]) {
    const needle = prefix.slice(-len);
    if (!needle.trim()) continue;
    let best: number | null = null;
    let bestDist = Infinity;
    let searchFrom = 0;
    for (;;) {
      const at = source.indexOf(needle, searchFrom);
      if (at < 0) break;
      const dist = Math.abs(at - estimatedPos);
      if (dist < bestDist) {
        bestDist = dist;
        best = at;
      }
      searchFrom = at + 1;
    }
    if (best !== null) return best + needle.length;
  }
  return prefix.trim() === "" ? 0 : null;
}

export function Block(props: {
  /** This block's position in the note, used to claim a pending paste caret. */
  index: number;
  text: string;
  active: boolean;
  onActivate: () => void;
  onChange: (value: string) => void;
  /** `skipPrune` defers the empty-block cleanup when focus is moving to
   *  another block — see deactivateBlock in blockActions.ts. */
  onDeactivate: (options?: { skipPrune?: boolean }) => void;
  /** Enter-split when called with just a cursor; multi-block paste reflow when
   *  called with a payload (see splitBlockAtCursor). */
  onSplit: (cursor: number, paste?: PastePayload) => void;
  onMergeIntoPrevious: () => void;
  /** Peers (name/color) currently editing this block, for a collab presence border. */
  peerEditors?: { name: string; color: string }[];
  /** Second Cmd/Ctrl+A while all text in this block's textarea is already selected. */
  onEscalateSelectAll?: () => void;
  /** Shift+Down/Up pressed at the block's bottom/top edge — escalate to
   *  whole-block selection extending in that direction (+1 down, -1 up). */
  onExtendBlockSelection?: (direction: 1 | -1) => void;
  /** Arrow-up/down past this block's first/last line — move the caret into
   *  the adjacent block at roughly `column`. False if there is no such block. */
  onNavigateBlock?: (direction: 1 | -1, column: number) => boolean;
  /** Show the "click to start typing" invite in the empty state. Only true for
   *  the sole block of an empty note — otherwise repeated blank lines (e.g. from
   *  pressing Enter several times) would each print the invite text. */
  showEmptyPlaceholder?: boolean;
  /** Known citekey -> entry map for the whole note (see collectBibliography),
   *  used to linkify "@key" mentions in rendered prose and to look up the
   *  hover card's contents. */
  bibliography?: Map<string, BibtexEntry>;
}) {
  const {
    index,
    text,
    active,
    onActivate,
    onChange,
    onDeactivate,
    onSplit,
    onMergeIntoPrevious,
    peerEditors = [],
    onEscalateSelectAll,
    onExtendBlockSelection,
    onNavigateBlock,
    showEmptyPlaceholder = true,
    bibliography = EMPTY_BIBLIOGRAPHY,
  } = props;
  const t = useT();
  const peerBorder = peerEditors[0]
    ? { borderColor: peerEditors[0].color, boxShadow: `0 0 0 1px ${peerEditors[0].color}` }
    : undefined;
  const peerLabel = peerEditors.length > 0 ? peerEditors.map((p) => p.name).join(", ") : undefined;
  // Caret position requested by the click that activated this block; consumed
  // by the live-preview editor as it mounts.
  const pendingCaretRef = useRef<number | null>(null);
  // The citekey currently hovered/focused in the rendered view (if any), plus
  // its span's viewport rect so the hover card can anchor near it.
  const [citePopover, setCitePopover] = useState<{ key: string; rect: DOMRect } | null>(null);

  // Delegated .bibtex-ref hover/focus handling for the rendered-prose branch
  // below — checked via closest() so it fires regardless of which descendant
  // node the mouse/focus event actually targets.
  function handleCiteHoverStart(e: JSX.TargetedEvent<HTMLDivElement>) {
    const ref = (e.target as HTMLElement).closest?.(".bibtex-ref") as HTMLElement | null;
    if (!ref) return;
    const key = ref.dataset.key;
    if (!key) return;
    setCitePopover({ key, rect: ref.getBoundingClientRect() });
  }

  function handleCiteHoverEnd(e: JSX.TargetedEvent<HTMLDivElement>) {
    if (!(e.target as HTMLElement).closest?.(".bibtex-ref")) return;
    setCitePopover(null);
  }

  function handleRenderedClick(e: JSX.TargetedMouseEvent<HTMLDivElement>) {
    const container = e.currentTarget;
    const target = e.target as HTMLElement;

    // Task checkbox: toggle in the source without entering edit mode.
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      e.preventDefault();
      e.stopPropagation();
      const boxes = Array.from(container.querySelectorAll("input[type=checkbox]"));
      const idx = boxes.indexOf(target);
      if (idx >= 0) onChange(toggleNthTask(text, idx));
      return;
    }

    // The mouse-up that ends a drag-to-select fires a click too. If the user
    // just selected text (to copy it) — including a drag that started in a
    // different block and was dragged into this one, which lands the
    // selection's anchor outside `container` — don't swap to the editor, as
    // that would collapse the selection to a caret and make selecting text
    // in view mode (single- or multi-block) impossible. A plain click leaves
    // the selection collapsed, so this only bails on a real range selection.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }

    pendingCaretRef.current = sourceOffsetFromClick(container, text, e.clientX, e.clientY);
    onActivate();
  }

  // Keys coming from inner interactive elements (task checkboxes, table
  // controls, links) must keep their native behavior, so only the block
  // itself activates.
  function keyIsForInnerControl(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): boolean {
    const target = e.target as HTMLElement;
    return target !== e.currentTarget && !!target.closest("button, a, input, textarea, select, [contenteditable]");
  }

  // Keyboard equivalent of clicking the empty block — a true button (leaf
  // content, click activates), so both Enter and Space fire.
  function handleActivateKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (keyIsForInnerControl(e)) return;
    e.preventDefault();
    onActivate();
  }

  // Keyboard access for the container views (table/mermaid/rendered). These
  // hold interactive descendants, so they are focusable regions rather than
  // role="button" (nested interactives are invalid ARIA), and only Enter
  // opens raw editing — Space keeps scrolling the page.
  function handleContainerKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>) {
    // Escape dismisses an open citation hover card (see the rendered-prose
    // branch below) without falling through to activating the block.
    if (e.key === "Escape" && citePopover) {
      setCitePopover(null);
      return;
    }
    if (e.key !== "Enter") return;
    if (keyIsForInnerControl(e)) return;
    e.preventDefault();
    onActivate();
  }

  if (active) {
    return (
      <LivePreviewEditor
        index={index}
        text={text}
        pendingCaretRef={pendingCaretRef}
        onChange={onChange}
        onSplit={onSplit}
        onMergeIntoPrevious={onMergeIntoPrevious}
        onDeactivate={onDeactivate}
        onEscalateSelectAll={onEscalateSelectAll}
        onExtendBlockSelection={onExtendBlockSelection}
        onNavigateBlock={onNavigateBlock}
      />
    );
  }

  if (text.trim() === "") {
    // A non-sole empty block is just a blank line — render a non-breaking space
    // so it keeps a full line's height (and stays clickable) without printing
    // the invite text on every blank line. It has to be U+00A0 written as an
    // escape, not a literal " ": a plain space collapses under white-space:
    // normal, leaving the row only its 4px of padding tall, so blank lines
    // rendered as slivers and everything below them sat too high.
    return (
      <div class="block block-empty" style={peerBorder} onClick={onActivate} onKeyDown={handleActivateKeyDown} tabIndex={0} role="button" title={peerLabel ?? t("block.clickToEdit")}>
        {showEmptyPlaceholder ? t("block.clickToStart") : "\u00a0"}
      </div>
    );
  }

  if (isTableMarkdown(text)) {
    return (
      <div class="block block-table-wrap" style={peerBorder} onKeyDown={handleContainerKeyDown} tabIndex={0} title={peerLabel}>
        <TableBlock text={text} onChange={onChange} onEditRaw={onActivate} />
      </div>
    );
  }

  if (isMermaidBlock(text)) {
    return (
      <div class="block block-mermaid-wrap" style={peerBorder} onKeyDown={handleContainerKeyDown} tabIndex={0} title={peerLabel}>
        <MermaidBlock text={text} onEditRaw={onActivate} />
      </div>
    );
  }

  if (isBibtexBlock(text)) {
    return (
      <div class="block block-bibtex-wrap" style={peerBorder} onKeyDown={handleContainerKeyDown} tabIndex={0} title={peerLabel}>
        <BibtexBlock text={text} onEditRaw={onActivate} />
      </div>
    );
  }

  const citeEntry = citePopover ? bibliography.get(citePopover.key) : undefined;

  return (
    <>
      <div
        class="block block-rendered"
        style={peerBorder}
        onClick={handleRenderedClick}
        onKeyDown={handleContainerKeyDown}
        onMouseOver={handleCiteHoverStart}
        onMouseOut={handleCiteHoverEnd}
        onFocus={handleCiteHoverStart}
        onBlur={handleCiteHoverEnd}
        tabIndex={0}
        title={peerLabel ?? t("block.clickToEdit")}
        dangerouslySetInnerHTML={{ __html: renderBlockHtml(text, bibliography) }}
      />
      {citePopover && citeEntry && <BibtexHoverCard entry={citeEntry} rect={citePopover.rect} />}
    </>
  );
}

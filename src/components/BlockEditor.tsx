import type { Ref } from "preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { PastePayload } from "../lib/blocks";
import type { BibtexEntry } from "../lib/bibtex";
import { fileToMarkdown } from "../lib/files";
import { syncDroppedFileToTcStorage } from "../lib/storageDriveInbox";
import { Block } from "./Block";
import { Icon } from "./Icon";
import { InsertMenu } from "./InsertMenu";
import { PageTitle } from "./PageTitle";
import type { PeerInfo } from "../lib/collab";
import { useT } from "../hooks/useAppSettings";

// Where a dragged block would land if dropped on the row currently under the
// pointer — "before"/"after" this row, per which half of its height the
// pointer is over. Drawn as a thin accent line on that edge of the row.
type DropIndicator = { index: number; position: "before" | "after" } | null;

export function BlockEditor(props: {
  titleInputRef: Ref<HTMLInputElement>;
  title: string;
  onTitleChange: (title: string) => void;
  blocks: string[];
  /** Stable per-block ids parallel to `blocks`, from useCollab — used as row keys so a
   *  remote insert/delete (which shifts indices) doesn't remount/mismap the focused block. */
  blockIds?: string[];
  activeBlockIndex: number | null;
  onActivate: (index: number) => void;
  onChange: (index: number, value: string) => void;
  onDeactivate: (options?: { skipPrune?: boolean }) => void;
  onAddBlock: () => void;
  onSplit: (index: number, cursor: number, paste?: PastePayload) => void;
  onMergeIntoPrevious: (index: number) => void;
  onInsertAfter: (index: number, scaffold: string, focus: boolean) => void;
  onInsertBlocksAfter: (index: number, scaffolds: string[], focus: boolean) => void;
  /** A dropped file was too large to embed inline (see lib/files.ts) — surfaced as a toast. */
  onFileTooLarge: (name: string) => void;
  onEscalateSelectAll: () => void;
  onExtendBlockSelection: (index: number, direction: 1 | -1) => void;
  /** Arrow-up/down past a block's first/last line — move the caret into the
   *  adjacent block. False at the first/last block. */
  onNavigateBlock: (index: number, direction: 1 | -1, column: number) => boolean;
  selectedBlocks: Set<number>;
  onShiftSelectBlock: (index: number) => void;
  onClearSelection: () => void;
  onReorder: (from: number, to: number) => void;
  collabPeers?: PeerInfo[];
  /** Known citekey -> entry map for the whole note (see collectBibliography),
   *  passed straight through to every Block for "@key" linkification. */
  bibliography?: Map<string, BibtexEntry>;
}) {
  const {
    titleInputRef,
    title,
    onTitleChange,
    blocks,
    blockIds = [],
    activeBlockIndex,
    onActivate,
    onChange,
    onDeactivate,
    onAddBlock,
    onSplit,
    onMergeIntoPrevious,
    onInsertAfter,
    onInsertBlocksAfter,
    onFileTooLarge,
    onEscalateSelectAll,
    onExtendBlockSelection,
    onNavigateBlock,
    selectedBlocks,
    onShiftSelectBlock,
    onClearSelection,
    onReorder,
    collabPeers = [],
    bibliography,
  } = props;
  const t = useT();
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null);
  // The last block, when empty, already invites typing (either as the
  // "クリックして入力を開始..." placeholder or an active textarea) — showing
  // the add-block prompt right below it too is a redundant, odd-looking gap.
  // Likewise while any block is being edited: Enter already creates the next
  // block, and having the prompt pop in mid-typing is distracting.
  const lastBlockEmpty = blocks.length > 0 && blocks[blocks.length - 1].trim() === "";
  const editing = activeBlockIndex !== null;

  function handleRowClickCapture(e: JSX.TargetedMouseEvent<HTMLDivElement>, index: number) {
    // Shift+click inside an editable control (the active block's textarea, a
    // table cell) is the native "extend text selection" gesture — leave it
    // alone. Only shift+click on the rendered block itself means "select this
    // range of blocks".
    if ((e.target as HTMLElement).closest("textarea, input, [contenteditable]")) return;
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      onShiftSelectBlock(index);
    } else if (selectedBlocks.size > 0) {
      onClearSelection();
    }
  }

  // Which half of the row (under the current pointer position) a drop would
  // land on — determines "insert before" vs "insert after" this row.
  function dropPositionFor(e: JSX.TargetedDragEvent<HTMLDivElement>): "before" | "after" {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  function handleDragStart(e: JSX.TargetedDragEvent<HTMLButtonElement>, index: number) {
    e.dataTransfer?.setData("text/plain", String(index));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    // A stale multi-block selection highlight shouldn't linger during a drag.
    onClearSelection();
  }

  function handleRowDragOver(e: JSX.TargetedDragEvent<HTMLDivElement>, index: number) {
    e.preventDefault();
    const isFiles = e.dataTransfer?.types.includes("Files");
    if (e.dataTransfer) e.dataTransfer.dropEffect = isFiles ? "copy" : "move";
    const position = dropPositionFor(e);
    setDropIndicator((prev) => (prev && prev.index === index && prev.position === position ? prev : { index, position }));
  }

  function handleRowDragLeave(e: JSX.TargetedDragEvent<HTMLDivElement>, index: number) {
    // Child elements firing their own dragleave shouldn't clear the
    // indicator while the pointer is still within this row.
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDropIndicator((prev) => (prev && prev.index === index ? null : prev));
  }

  // Dropped files are embedded as data-URL markdown (see lib/files.ts) and
  // spliced in as new blocks right after `afterIndex` — reusing the same
  // insert path the "+" menu uses, just with multiple scaffolds at once.
  // Separately (and independent of the note-embed size cap), each file is
  // also mirrored into tc-storage's drive on a best-effort basis, published
  // via the shared bus rather than written to tc-storage's own storage
  // directly — see storageDriveInbox.ts for why that needs its own
  // encrypted-upload step rather than just writing the same markdown/data-URL
  // there too.
  async function insertDroppedFiles(files: FileList, afterIndex: number) {
    const fileList = Array.from(files);
    const results = await Promise.all(fileList.map(fileToMarkdown));
    const scaffolds: string[] = [];
    for (const result of results) {
      if ("tooLarge" in result) onFileTooLarge(result.name);
      else scaffolds.push(result.markdown);
    }
    if (scaffolds.length > 0) onInsertBlocksAfter(afterIndex, scaffolds, false);
    for (const file of fileList) void syncDroppedFileToTcStorage(file);
  }

  function handleRowDrop(e: JSX.TargetedDragEvent<HTMLDivElement>, index: number) {
    e.preventDefault();
    const position = dropPositionFor(e);
    setDropIndicator(null);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      e.stopPropagation();
      void insertDroppedFiles(files, position === "after" ? index : index - 1);
      return;
    }
    const raw = e.dataTransfer?.getData("text/plain");
    if (raw == null || raw === "") return;
    const from = Number(raw);
    if (Number.isNaN(from)) return;
    const target = position === "after" ? index + 1 : index;
    onReorder(from, target);
  }

  // Fallback for a file dropped somewhere in the editor that isn't over a
  // specific row (the title, the padding around rows) — just appends at the
  // end rather than rejecting the drop outright.
  function handleEditorDragOver(e: JSX.TargetedDragEvent<HTMLDivElement>) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleEditorDrop(e: JSX.TargetedDragEvent<HTMLDivElement>) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    e.preventDefault();
    void insertDroppedFiles(files, blocks.length - 1);
  }

  return (
    <div class="block-editor" onDragOver={handleEditorDragOver} onDrop={handleEditorDrop}>
      <PageTitle
        titleInputRef={titleInputRef}
        title={title}
        onTitleChange={onTitleChange}
        onEnter={() => onActivate(0)}
      />
      {blocks.map((block, i) => (
        <div
          key={blockIds[i] ?? i}
          class={`block-row ${selectedBlocks.has(i) ? "block-row--selected" : ""} ${
            activeBlockIndex === i ? "block-row--active" : ""
          } ${dropIndicator?.index === i ? `block-row--drop-${dropIndicator.position}` : ""}`}
          onClickCapture={(e) => handleRowClickCapture(e, i)}
          onDragOver={(e) => handleRowDragOver(e, i)}
          onDragLeave={(e) => handleRowDragLeave(e, i)}
          onDrop={(e) => handleRowDrop(e, i)}
        >
          <button
            type="button"
            class="block-drag-handle"
            draggable
            onDragStart={(e) => handleDragStart(e, i)}
            onDragEnd={() => setDropIndicator(null)}
            title={t("blockEditor.dragToReorder")}
            aria-label={t("blockEditor.dragToReorder")}
          >
            <Icon name="drag-handle" size={16} />
          </button>
          <InsertMenu className="block-gutter-insert" title={t("blockEditor.insertBelow")} onInsert={(scaffold, focus) => onInsertAfter(i, scaffold, focus)} />
          <Block
            index={i}
            text={block}
            active={activeBlockIndex === i}
            onActivate={() => onActivate(i)}
            onChange={(v) => onChange(i, v)}
            onDeactivate={onDeactivate}
            onSplit={(cursor, paste) => onSplit(i, cursor, paste)}
            onMergeIntoPrevious={() => onMergeIntoPrevious(i)}
            onEscalateSelectAll={onEscalateSelectAll}
            onExtendBlockSelection={(dir) => onExtendBlockSelection(i, dir)}
            onNavigateBlock={(dir, column) => onNavigateBlock(i, dir, column)}
            showEmptyPlaceholder={blocks.length === 1}
            peerEditors={collabPeers.filter((p) => p.activeBlock === i)}
            bibliography={bibliography}
          />
        </div>
      ))}
      {!lastBlockEmpty && !editing && (
        <div class="block-add-row">
          <div class="block-add" onClick={onAddBlock} title={t("blockEditor.addNewBlock")}>
            {t("blockEditor.addBlockPrompt")}
          </div>
          <InsertMenu className="block-gutter-insert block-gutter-insert--end" title={t("insertMenu.addBlock")} onInsert={(scaffold, focus) => onInsertAfter(blocks.length - 1, scaffold, focus)} />
        </div>
      )}
    </div>
  );
}

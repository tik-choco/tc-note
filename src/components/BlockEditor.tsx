import type { Ref } from "preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { PastePayload } from "../lib/blocks";
import type { BibtexEntry } from "../lib/bibtex";
import { fileToMarkdown, renameGenericClipboardImage } from "../lib/files";
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

// How long an image-paste embed (resize + base64-encode, see
// handleImagePaste below) can run before it's worth telling the user
// something's happening — most screenshots resolve well under this, so the
// toast only appears for genuinely large/slow ones.
const IMAGE_PASTE_PROCESSING_DELAY_MS = 400;

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
  /** A pasted image (Ctrl+V of a screenshot) is being resized/encoded and is
   *  taking a while — surfaced as a toast (imagePaste.processing). Optional:
   *  the paste still completes without it, just silently. */
  onImagePasteProcessing?: () => void;
  /** A pasted image failed to embed (e.g. a FileReader error) — surfaced as
   *  a toast (imagePaste.failed). */
  onImagePasteFailed?: () => void;
  /** A pasted image was too large to embed even after downscaling —
   *  surfaced as a toast (imagePaste.tooLarge). Falls back to onFileTooLarge
   *  if not wired, so the failure is never silent. */
  onImagePasteTooLarge?: (name: string) => void;
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
    onImagePasteProcessing,
    onImagePasteFailed,
    onImagePasteTooLarge,
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

  // Shared core of the drop and paste image-embed paths: encodes each file
  // to a markdown scaffold (resizing images that are too big to embed
  // inline — see lib/imageResize.ts, invoked inside fileToMarkdown) and
  // splices the successful ones in right after `afterIndex`, the same
  // insert-blocks action the "+" menu uses. A file that's still too large
  // after resizing reports via `onTooLarge` instead of being inserted. Kept
  // as one function (rather than duplicated per caller) so a pasted image
  // and a dropped image always end up in exactly the same state.
  async function embedFiles(files: File[], afterIndex: number, onTooLarge: (name: string) => void) {
    const results = await Promise.all(files.map(fileToMarkdown));
    const scaffolds: string[] = [];
    for (const result of results) {
      if ("tooLarge" in result) onTooLarge(result.name);
      else scaffolds.push(result.markdown);
    }
    if (scaffolds.length > 0) onInsertBlocksAfter(afterIndex, scaffolds, false);
  }

  // Dropped files are embedded as data-URL markdown and spliced in as new
  // blocks right after `afterIndex` (see embedFiles above). Separately (and
  // independent of the note-embed size cap), each file is also mirrored
  // into tc-storage's drive on a best-effort basis, published via the shared
  // bus rather than written to tc-storage's own storage directly — see
  // storageDriveInbox.ts for why that needs its own encrypted-upload step
  // rather than just writing the same markdown/data-URL there too.
  async function insertDroppedFiles(files: FileList, afterIndex: number) {
    const fileList = Array.from(files);
    await embedFiles(fileList, afterIndex, onFileTooLarge);
    for (const file of fileList) void syncDroppedFileToTcStorage(file);
  }

  // Ctrl+V of a screenshot (see LivePreviewEditor's handlePaste) lands here
  // with the raw clipboard File, `index` being the block that was active
  // when the paste happened. Reuses embedFiles — the exact same pipeline a
  // drop uses — just anchored at the active block instead of the row under
  // the pointer, so a pasted image and a dropped image end up in exactly the
  // same state. The paste path gets its own toast copy (imagePaste.*,
  // distinct from the drop path's blockEditor.fileTooLarge) via the
  // onImagePaste* props; onImagePasteTooLarge falls back to onFileTooLarge
  // so the failure is never silently dropped if the former isn't wired.
  async function handleImagePaste(index: number, file: File) {
    let settled = false;
    const timer = onImagePasteProcessing
      ? setTimeout(() => {
          if (!settled) onImagePasteProcessing();
        }, IMAGE_PASTE_PROCESSING_DELAY_MS)
      : undefined;
    try {
      const named = renameGenericClipboardImage(file);
      await embedFiles([named], index, onImagePasteTooLarge ?? onFileTooLarge);
      void syncDroppedFileToTcStorage(named);
    } catch {
      onImagePasteFailed?.();
    } finally {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
    }
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
            onPasteImage={(file) => void handleImagePaste(i, file)}
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

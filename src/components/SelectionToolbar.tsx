import { Icon } from "./Icon";

type Props = {
  rect: { left: number; top: number };
  onBold: () => void;
  onItalic: () => void;
  onCode: () => void;
  onLink: () => void;
};

// A small floating pill that appears above a text selection inside the
// active block, offering quick inline formatting — select text, get a
// toolbar. Purely presentational: callers own the CodeMirror view and decide
// what each button actually does.
export function SelectionToolbar(props: Props) {
  const { rect, onBold, onItalic, onCode, onLink } = props;
  return (
    <div
      class="selection-toolbar"
      style={{ left: `${rect.left}px`, top: `${rect.top}px` }}
      // The toolbar must never steal focus from the CodeMirror editor — a
      // mousedown on a button would otherwise collapse the selection before
      // the click handler runs.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" class="selection-toolbar-btn" onClick={onBold} title="Bold (Ctrl+B)">
        <span class="selection-toolbar-glyph selection-toolbar-glyph--bold">B</span>
      </button>
      <button type="button" class="selection-toolbar-btn" onClick={onItalic} title="Italic (Ctrl+I)">
        <span class="selection-toolbar-glyph selection-toolbar-glyph--italic">I</span>
      </button>
      <button type="button" class="selection-toolbar-btn" onClick={onCode} title="Inline code">
        <span class="selection-toolbar-glyph selection-toolbar-glyph--code">{"</>"}</span>
      </button>
      <button type="button" class="selection-toolbar-btn" onClick={onLink} title="Link">
        <Icon name="link" size={15} />
      </button>
    </div>
  );
}

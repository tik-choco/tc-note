import type { JSX } from "preact";
import type { SlashItem } from "../lib/cm/slashMenu";

type Props = {
  items: SlashItem[];
  highlightedIndex: number;
  coords: { left: number; top: number };
  onPick: (item: SlashItem) => void;
  onHighlightChange: (index: number) => void;
};

// Presentational only: no state, no keyboard handling. The caller owns
// open/closed, the highlighted index, and Arrow/Enter/Escape — this just
// renders whatever it's told and reports mouse interaction back up.
export function SlashMenu(props: Props): JSX.Element | null {
  const { items, highlightedIndex, coords, onPick, onHighlightChange } = props;

  if (items.length === 0) return null;

  return (
    <div
      class="slash-menu"
      role="listbox"
      style={{ left: `${coords.left}px`, top: `${coords.top}px` }}
      // A mousedown on this popup must not blur the CodeMirror editor first —
      // that would deactivate the block (and unmount this menu) before the
      // click's onPick ever runs.
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <div
          key={item.key}
          role="option"
          aria-selected={i === highlightedIndex}
          class={i === highlightedIndex ? "slash-menu-item slash-menu-item--active" : "slash-menu-item"}
          onMouseEnter={() => onHighlightChange(i)}
          onClick={() => onPick(item)}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}

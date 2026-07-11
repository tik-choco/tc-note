import { EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export type ToolbarRect = { left: number; top: number } | null;

// Reports where to float the selection format toolbar: the horizontal
// midpoint and topmost edge of the current (non-empty) selection, in
// viewport coordinates. Null closes the toolbar — collapsed selection, no
// selection, or mid-IME-composition (a composing selection is provisional).
function computeToolbarRect(view: EditorView): ToolbarRect {
  if (view.composing) return null;
  const { main } = view.state.selection;
  if (main.empty) return null;
  const from = view.coordsAtPos(main.from);
  const to = view.coordsAtPos(main.to);
  if (!from || !to) return null;
  const top = Math.min(from.top, to.top);
  const left = (from.left + to.right) / 2;
  return { left, top };
}

const sameRect = (a: ToolbarRect, b: ToolbarRect) =>
  a === b || (a !== null && b !== null && a.left === b.left && a.top === b.top);

export function selectionToolbarWatcher(onChange: (rect: ToolbarRect, view: EditorView) => void): Extension {
  return ViewPlugin.fromClass(
    class {
      last: ToolbarRect = null;
      constructor(view: EditorView) {
        this.schedule(view);
      }
      update(update: ViewUpdate): void {
        if (!update.docChanged && !update.selectionSet && !update.viewportChanged) return;
        this.schedule(update.view);
      }
      // coordsAtPos needs layout info, which CM forbids reading synchronously
      // during a plugin's construction/update — defer to a measure pass.
      schedule(view: EditorView): void {
        view.requestMeasure<ToolbarRect>({
          key: "selection-toolbar",
          read: computeToolbarRect,
          write: (rect, v) => {
            if (sameRect(this.last, rect)) return;
            this.last = rect;
            onChange(rect, v);
          },
        });
      }
    },
  );
}

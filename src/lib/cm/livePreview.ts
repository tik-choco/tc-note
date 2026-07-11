import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSet } from "@codemirror/state";
import type { Range } from "@codemirror/state";

// Live preview: the markdown source stays the document, but the syntax markers
// (#, **, `, [](), >, list bullets) are always hidden and the text they wrap is
// styled inline — the markers never reappear, even on the line being edited, so
// the editing surface reads like the rendered note. The hidden marker ranges
// are also registered as atomic so the caret skips over them (you can't land
// between the hidden "#" and the heading text and accidentally type into it).

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-lp-bullet";
    span.textContent = "•";
    return span;
  }
}

// Renders a task item's "[ ]"/"[x]" as a real checkbox. Clicks are toggled by
// the mousedown handler in the exported extension (which flips the source char).
class CheckboxWidget extends WidgetType {
  readonly checked: boolean;
  constructor(checked: boolean) {
    super();
    this.checked = checked;
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  toDOM(): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-task";
    box.checked = this.checked;
    box.setAttribute("aria-label", "toggle task");
    return box;
  }
  ignoreEvent(): boolean {
    // Let the editor's mousedown handler see clicks on the box so it can toggle.
    return false;
  }
}

// Collapses a range to nothing (hides the marker).
const hide = Decoration.replace({});
// Replaces a "-"/"*"/"+" list marker with a real bullet glyph.
const bullet = Decoration.replace({ widget: new BulletWidget() });

// Container node -> class applied to its whole span (markers included; the
// markers are separately hidden, so only the visible text picks up the style).
const CONTENT_CLASS: Record<string, string> = {
  StrongEmphasis: "cm-lp-strong",
  Emphasis: "cm-lp-em",
  Strikethrough: "cm-lp-strike",
  InlineCode: "cm-lp-code",
  Link: "cm-lp-link",
};

type Built = { decorations: DecorationSet; atomic: RangeSet<Decoration> };

function buildDecorations(view: EditorView): Built {
  const decos: Range<Decoration>[] = [];
  // Hidden/replaced marker ranges, also fed to the atomic-ranges facet so the
  // caret treats each collapsed marker as a single skippable unit.
  const hidden: Range<Decoration>[] = [];
  const { state } = view;
  const { doc } = state;

  const conceal = (deco: Decoration, from: number, to: number) => {
    const r = deco.range(from, to);
    decos.push(r);
    hidden.push(r);
  };

  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name;

      // Headings: style the whole line, hide the leading "#"s + their space.
      const heading = /^ATXHeading([1-6])$/.exec(name);
      if (heading) {
        const line = doc.lineAt(node.from);
        decos.push(Decoration.line({ class: `cm-lp-h${heading[1]}` }).range(line.from));
        return;
      }
      if (name === "HeaderMark") {
        let to = node.to;
        if (doc.sliceString(to, to + 1) === " ") to += 1;
        conceal(hide, node.from, to);
        return;
      }

      // Inline emphasis / code / strike / link: style the content span.
      const contentClass = CONTENT_CLASS[name];
      if (contentClass) {
        decos.push(Decoration.mark({ class: contentClass }).range(node.from, node.to));
        return;
      }
      // ...and hide their markers.
      if (name === "EmphasisMark" || name === "CodeMark" || name === "StrikethroughMark") {
        conceal(hide, node.from, node.to);
        return;
      }
      // Link scaffolding: "[", "]", "(", ")" and the URL itself.
      if (name === "LinkMark" || name === "URL") {
        if (node.to > node.from) conceal(hide, node.from, node.to);
        return;
      }

      // Blockquote: border the line, hide the ">".
      if (name === "QuoteMark") {
        const line = doc.lineAt(node.from);
        decos.push(Decoration.line({ class: "cm-lp-quote" }).range(line.from));
        let to = node.to;
        if (doc.sliceString(to, to + 1) === " ") to += 1;
        conceal(hide, node.from, to);
        return;
      }

      // Unordered list markers become a bullet glyph; ordered lists ("1.") stay
      // raw so the numbering reads correctly.
      if (name === "ListMark") {
        const text = doc.sliceString(node.from, node.to);
        if (text === "-" || text === "*" || text === "+") {
          const line = doc.lineAt(node.from);
          if (/^\s*[-*+]\s+\[[ xX]\]/.test(line.text)) {
            // Task item: hide the bullet marker and its space entirely — the
            // TaskMarker below stands in for it as a checkbox.
            let to = node.to;
            if (doc.sliceString(to, to + 1) === " ") to += 1;
            conceal(hide, node.from, to);
          } else {
            conceal(bullet, node.from, node.to);
          }
        }
        return;
      }

      // Task checkbox "[ ]" / "[x]" -> an interactive checkbox widget.
      if (name === "TaskMarker") {
        const checked = /[xX]/.test(doc.sliceString(node.from, node.to));
        conceal(Decoration.replace({ widget: new CheckboxWidget(checked) }), node.from, node.to);
        return;
      }
    },
  });

  return {
    decorations: Decoration.set(decos, true),
    atomic: RangeSet.of(hidden, true),
  };
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: RangeSet<Decoration>;
    constructor(view: EditorView) {
      const built = buildDecorations(view);
      this.decorations = built.decorations;
      this.atomic = built.atomic;
    }
    update(update: ViewUpdate): void {
      // Decorations depend only on the document (not the cursor), so a plain
      // selection move doesn't rebuild them.
      if (update.docChanged || update.viewportChanged) {
        const built = buildDecorations(update.view);
        this.decorations = built.decorations;
        this.atomic = built.atomic;
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export const livePreview = [
  plugin,
  EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? RangeSet.empty),
  // Toggle a task checkbox on click: flip the " "/"x" inside its "[ ]" marker.
  EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target = event.target as HTMLElement;
      if (!(target instanceof HTMLInputElement) || !target.classList.contains("cm-lp-task")) {
        return false;
      }
      const pos = view.posAtDOM(target);
      const marker = view.state.sliceDoc(pos, pos + 3);
      const m = /^\[([ xX])\]$/.exec(marker);
      if (!m) return false;
      const flipped = m[1] === " " ? "x" : " ";
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: flipped } });
      event.preventDefault();
      return true;
    },
  }),
];

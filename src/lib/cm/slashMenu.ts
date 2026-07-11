import type { EditorView, PluginValue, ViewUpdate } from "@codemirror/view";
import { ViewPlugin } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export type SlashTrigger = { from: number; to: number; query: string } | null;

/**
 * Pure, DOM-free: given the full document text and a collapsed caret offset
 * (absolute position in docText), returns the active "/query" trigger, or
 * null if none. The trigger fires when the CURRENT LINE's text — from the
 * line's start up to `caret` — is exactly "/" followed by zero or more
 * NON-WHITESPACE characters (Unicode-aware: this app ships in 8 languages,
 * so a query like "/見出し" must trigger too — do not restrict to ASCII
 * alnum). `from` is the offset of the "/" itself, `to` is `caret`, `query`
 * is everything between them (not including the "/").
 *
 * Examples (docText, caret) -> result:
 *   ("/", 1) -> { from: 0, to: 1, query: "" }
 *   ("/head", 5) -> { from: 0, to: 5, query: "head" }
 *   ("hello\n/qu", 10) -> { from: 6, to: 10, query: "qu" }   // second line
 *   ("a/b", 3) -> null                          // "/" not at line start
 *   ("/foo bar", 8) -> null                     // space breaks the trigger
 *   ("/foo", 2) -> null                         // caret not at the END of the "/query" run
 *   ("", 0) -> null
 */
export function computeSlashTrigger(docText: string, caret: number): SlashTrigger {
  if (!Number.isFinite(caret) || caret < 0) return null;

  // Start of the current line: just past the last newline at or before
  // caret - 1 (or 0 if there is none). Out-of-range indices are clamped by
  // String.prototype.lastIndexOf itself.
  const lineStart = docText.lastIndexOf("\n", caret - 1) + 1;
  const prefix = docText.slice(lineStart, caret);

  if (prefix.length === 0 || prefix[0] !== "/") return null;

  const query = prefix.slice(1);
  if (/\s/.test(query)) return null;

  // The caret must sit at the end of the contiguous "/query" run: if
  // whatever comes right after it is itself a non-whitespace character,
  // the caret is mid-token, not at the end of it.
  const nextChar = caret < docText.length ? docText[caret] : "";
  if (nextChar !== "" && !/\s/.test(nextChar)) return null;

  return { from: lineStart, to: caret, query };
}

export type SlashItem = { key: string; label: string; insertText: string; caretOffset?: number };

/**
 * Case-insensitive substring match of `query` against each item's `label`.
 * Empty query returns all items, unfiltered, in the given order.
 */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  if (query === "") return items;
  const needle = query.toLowerCase();
  return items.filter((item) => item.label.toLowerCase().includes(needle));
}

/**
 * Replaces the [from, to) range in the document with `insertText`, places
 * the caret at `from + (caretOffset ?? insertText.length)`, and keeps focus
 * on the view.
 */
export function applySlashTrigger(
  view: EditorView,
  range: { from: number; to: number },
  insertText: string,
  caretOffset?: number,
): void {
  const anchor = range.from + (caretOffset ?? insertText.length);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: insertText },
    selection: { anchor },
  });
  view.focus();
}

function sameTrigger(a: SlashTrigger, b: SlashTrigger): boolean {
  if (a === null || b === null) return a === b;
  return a.from === b.from && a.to === b.to && a.query === b.query;
}

function computeViewTrigger(view: EditorView): SlashTrigger {
  // Never show the menu mid-IME-composition, and only ever for a collapsed
  // caret (a non-empty selection range has nothing to trigger from).
  if (view.composing) return null;
  const range = view.state.selection.main;
  if (!range.empty) return null;
  return computeSlashTrigger(view.state.doc.toString(), range.head);
}

/**
 * A CodeMirror extension: on every relevant document/selection update, computes
 * the current SlashTrigger (via computeSlashTrigger against the live doc/cursor)
 * and calls onChange(trigger, view). Must NOT call back redundantly for an
 * unchanged trigger value (compare from/to/query, not object identity). Must
 * report null (closing the menu) whenever: the trigger condition no longer
 * holds, the selection becomes a non-empty range, or `view.composing` is true
 * (mid-IME-composition — never show the menu while composing).
 */
export function slashTriggerWatcher(onChange: (trigger: SlashTrigger, view: EditorView) => void): Extension {
  class SlashTriggerViewPlugin implements PluginValue {
    lastTrigger: SlashTrigger = null;

    update(update: ViewUpdate): void {
      if (!update.docChanged && !update.selectionSet) return;

      const trigger = computeViewTrigger(update.view);
      if (sameTrigger(trigger, this.lastTrigger)) return;

      this.lastTrigger = trigger;
      onChange(trigger, update.view);
    }
  }

  return ViewPlugin.fromClass(SlashTriggerViewPlugin);
}

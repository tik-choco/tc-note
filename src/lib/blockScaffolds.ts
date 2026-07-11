// Markdown scaffolds inserted by the "+" insert menu. `focus` controls
// whether the newly-inserted block is opened for text editing right away
// (headings/lists/quotes — the user is about to type into them) or left in
// view mode (table/mermaid/hr — these render their own UI immediately).
// Labels are i18n keys resolved by the menu; scaffolds that embed
// user-visible text (the table's column headers) take the bound `t` so the
// generated markdown matches the UI language.
import type { TranslationKey } from "./i18n";

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

export interface InsertOption {
  key: string;
  labelKey: TranslationKey;
  scaffold: string | ((t: Translate) => string);
  focus: boolean;
}

export const INSERT_OPTIONS: InsertOption[] = [
  { key: "h1", labelKey: "insertMenu.h1", scaffold: "# ", focus: true },
  { key: "h2", labelKey: "insertMenu.h2", scaffold: "## ", focus: true },
  { key: "h3", labelKey: "insertMenu.h3", scaffold: "### ", focus: true },
  { key: "bullet", labelKey: "insertMenu.bullet", scaffold: "- ", focus: true },
  { key: "numbered", labelKey: "insertMenu.numbered", scaffold: "1. ", focus: true },
  { key: "checklist", labelKey: "insertMenu.checklist", scaffold: "- [ ] ", focus: true },
  { key: "quote", labelKey: "insertMenu.quote", scaffold: "> ", focus: true },
  { key: "code", labelKey: "insertMenu.code", scaffold: "```\n\n```", focus: true },
  { key: "math", labelKey: "insertMenu.math", scaffold: "$$\n\n$$", focus: true },
  {
    key: "table",
    labelKey: "insertMenu.table",
    scaffold: (t) =>
      `| ${t("tableBlock.newColumnHeader", { n: 1 })} | ${t("tableBlock.newColumnHeader", { n: 2 })} |\n| --- | --- |\n|  |  |`,
    focus: false,
  },
  {
    key: "mermaid",
    labelKey: "insertMenu.mermaid",
    scaffold: (t) =>
      `\`\`\`mermaid\nflowchart TD\n  A[${t("insertMenu.mermaidStart")}] --> B{${t("insertMenu.mermaidDecision")}}\n  B -->|Yes| C[${t("insertMenu.mermaidProcess")}]\n  B -->|No| D[${t("insertMenu.mermaidEnd")}]\n\`\`\``,
    focus: false,
  },
  { key: "hr", labelKey: "insertMenu.hr", scaffold: "---", focus: false },
];

export function resolveScaffold(option: InsertOption, t: Translate): string {
  return typeof option.scaffold === "function" ? option.scaffold(t) : option.scaffold;
}

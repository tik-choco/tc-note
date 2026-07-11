// Parses/serializes GFM-style markdown tables so the table block can offer a
// grid editing UI while keeping the block's storage format a plain markdown
// string (same convention as every other block type).
export type TableAlign = "left" | "center" | "right" | null;

export interface TableModel {
  headers: string[];
  aligns: TableAlign[];
  rows: string[][];
}

const DELIM_LINE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function isTableMarkdown(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const lines = trimmed.split("\n");
  if (lines.length < 2) return false;
  if (!lines[0].includes("|")) return false;
  return DELIM_LINE.test(lines[1]);
}

export function parseTable(text: string): TableModel | null {
  if (!isTableMarkdown(text)) return null;
  const lines = text.trim().split("\n");
  const headers = splitRow(lines[0]);
  const delims = splitRow(lines[1]);
  const aligns: TableAlign[] = delims.map((d) => {
    const left = d.startsWith(":");
    const right = d.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
  const rows = lines.slice(2).map((l) => splitRow(l));
  return { headers, aligns, rows };
}

function escapeCell(v: string): string {
  return v.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function alignToDelim(a: TableAlign): string {
  if (a === "center") return ":---:";
  if (a === "right") return "---:";
  if (a === "left") return ":---";
  return "---";
}

export function serializeTable(model: TableModel): string {
  const headerLine = `| ${model.headers.map(escapeCell).join(" | ")} |`;
  const delimLine = `| ${model.aligns.map(alignToDelim).join(" | ")} |`;
  const rowLines = model.rows.map((r) => `| ${model.headers.map((_, i) => escapeCell(r[i] ?? "")).join(" | ")} |`);
  return [headerLine, delimLine, ...rowLines].join("\n");
}

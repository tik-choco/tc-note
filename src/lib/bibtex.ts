// Hand-rolled BibTeX parser/detector, following the same convention as
// mermaidDetect.ts and table.ts: a tiny detector + parser for a block's raw
// markdown, no external dependency. "Good enough" parsing of common entry
// types is the bar here, not full BibTeX-spec compliance -- @string macros,
// @comment entries, and crossref resolution are intentionally unsupported.
export interface BibtexEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
}

export function isBibtexBlock(text: string): boolean {
  return /^```bibtex\b[\s\S]*```\s*$/.test(text.trim());
}

export function bibtexSource(text: string): string {
  return text
    .trim()
    .replace(/^```bibtex[^\n]*\n?/, "")
    .replace(/```\s*$/, "");
}

// Parses one field's value starting at src[i], where src[i] is the first
// non-whitespace character after the field's "=". Supports {braced} values
// (with arbitrarily nested braces), "quoted" values, and bare words. Returns
// the parsed value plus the index just past it.
function readFieldValue(src: string, i: number): { value: string; next: number } {
  const n = src.length;
  if (src[i] === "{") {
    i++;
    let depth = 1;
    const start = i;
    while (i < n && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const value = src.slice(start, i);
    if (i < n) i++; // skip the matching closing brace
    return { value, next: i };
  }
  if (src[i] === '"') {
    i++;
    const start = i;
    while (i < n && src[i] !== '"') i++;
    const value = src.slice(start, i);
    if (i < n) i++; // skip the closing quote
    return { value, next: i };
  }
  const start = i;
  while (i < n && src[i] !== ",") i++;
  return { value: src.slice(start, i).trim(), next: i };
}

// Parses the "field = value, field2 = value2, ..." portion of an entry body
// (everything after the citekey and its comma). Field names are lowercased.
// A field with no "=" is skipped rather than aborting the whole entry.
function parseFields(src: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const n = src.length;
  let i = 0;
  while (i < n) {
    while (i < n && /[\s,]/.test(src[i])) i++;
    if (i >= n) break;

    const nameStart = i;
    while (i < n && !/[\s=]/.test(src[i])) i++;
    const name = src.slice(nameStart, i).trim().toLowerCase();

    while (i < n && /\s/.test(src[i])) i++;
    if (src[i] !== "=") {
      // Malformed field (no value) -- skip to the next comma rather than
      // aborting the rest of the entry.
      while (i < n && src[i] !== ",") i++;
      continue;
    }
    i++; // past '='
    while (i < n && /\s/.test(src[i])) i++;

    const { value, next } = readFieldValue(src, i);
    i = next;
    if (name) fields[name] = value.trim();

    while (i < n && /\s/.test(src[i])) i++;
    if (src[i] === ",") i++;
  }
  return fields;
}

// Scans `source` for `@type{key, field = value, ...}` entries. Braces inside
// field values (e.g. `title = {A {Study} of X}`) are tracked by depth so the
// entry's own closing brace is only matched once depth returns to zero.
// %-prefixed comment lines and blank lines are ignored.
export function parseBibtex(source: string): BibtexEntry[] {
  const cleaned = source
    .split("\n")
    .filter((line) => !/^\s*%/.test(line))
    .join("\n");

  const entries: BibtexEntry[] = [];
  const n = cleaned.length;
  let i = 0;

  while (i < n) {
    const at = cleaned.indexOf("@", i);
    if (at < 0) break;

    let j = at + 1;
    const typeStart = j;
    while (j < n && /[a-zA-Z]/.test(cleaned[j])) j++;
    const type = cleaned.slice(typeStart, j).toLowerCase();

    while (j < n && /\s/.test(cleaned[j])) j++;
    if (cleaned[j] !== "{") {
      // Not a recognizable entry opening (e.g. a stray "@" in prose) --
      // resume scanning right after this "@".
      i = at + 1;
      continue;
    }

    j++; // past the entry's opening brace
    let depth = 1;
    const bodyStart = j;
    while (j < n && depth > 0) {
      if (cleaned[j] === "{") depth++;
      else if (cleaned[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    const body = cleaned.slice(bodyStart, j);
    if (j < n) j++; // past the entry's closing brace
    i = j;

    if (!type) continue;
    const commaIdx = body.indexOf(",");
    const key = (commaIdx >= 0 ? body.slice(0, commaIdx) : body).trim();
    if (!key) continue;
    const fieldsSrc = commaIdx >= 0 ? body.slice(commaIdx + 1) : "";
    entries.push({ key, type, fields: parseFields(fieldsSrc) });
  }

  return entries;
}

// Scans every block for ```bibtex fences and merges their entries into one
// map keyed by citekey, for note-wide lookup (rendering + inline @citekey
// linkification). If the same key is defined more than once across the note,
// the first occurrence encountered wins.
export function collectBibliography(blocks: string[]): Map<string, BibtexEntry> {
  const map = new Map<string, BibtexEntry>();
  for (const block of blocks) {
    if (!isBibtexBlock(block)) continue;
    for (const entry of parseBibtex(bibtexSource(block))) {
      if (!map.has(entry.key)) map.set(entry.key, entry);
    }
  }
  return map;
}

export interface OutlineItem {
  level: number;
  text: string;
  /** character offset of the heading line's start within the source markdown */
  offset: number;
}

export function extractOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let offset = 0;
  for (const line of markdown.split("\n")) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      items.push({ level: match[1].length, text: match[2].trim(), offset });
    }
    offset += line.length + 1;
  }
  return items;
}

export function isMermaidBlock(text: string): boolean {
  return /^```mermaid\b[\s\S]*```\s*$/.test(text.trim());
}

export function mermaidSource(text: string): string {
  return text
    .trim()
    .replace(/^```mermaid[^\n]*\n?/, "")
    .replace(/```\s*$/, "");
}

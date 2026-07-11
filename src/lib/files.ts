// Turns a dropped File into a markdown snippet to embed inline. tc-note has
// no file-storage backend (everything lives in localStorage — see mistlib.ts),
// so there's nowhere to upload a dropped file to; it's embedded directly as a
// data: URL instead. Kept out of BlockEditor so the encoding logic can be unit
// tested without mounting the editor.

// localStorage is origin-wide (shared with tc-pdf-viewer, see importDocument.ts)
// and typically capped around 5-10MB total, so a single embed is kept well
// under that rather than risking a save failure later.
const MAX_EMBED_BYTES = 4 * 1024 * 1024;

export type FileToMarkdownResult = { markdown: string } | { tooLarge: true; name: string };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

export async function fileToMarkdown(file: File): Promise<FileToMarkdownResult> {
  if (file.size > MAX_EMBED_BYTES) return { tooLarge: true, name: file.name };
  const dataUrl = await readAsDataUrl(file);
  // "]" would prematurely close the markdown alt/link text.
  const label = file.name.replace(/[[\]]/g, "");
  return { markdown: file.type.startsWith("image/") ? `![${label}](${dataUrl})` : `[${label}](${dataUrl})` };
}

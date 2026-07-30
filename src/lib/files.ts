// Turns a dropped or pasted File into a markdown snippet to embed inline.
// Note bodies are stored in mistlib's content-addressed byte store, not
// localStorage (only the small note index lives there — see mistlib.ts), so
// there *is* somewhere a file could be uploaded to; embedding as a data: URL
// is a deliberate choice instead: it keeps the image inside the Markdown body
// itself, so it survives export, sharing to sibling apps, and — importantly —
// real-time collab, where a CID would point at bytes a peer may not actually
// have. Kept out of BlockEditor so the encoding logic can be unit tested
// without mounting the editor.
import { resizeImageFile } from "./imageResize";

// localStorage is origin-wide (shared with tc-pdf-viewer, see importDocument.ts)
// and typically capped around 5-10MB total, so a single embed is kept well
// under that rather than risking a save failure later.
const MAX_EMBED_BYTES = 4 * 1024 * 1024;

export type FileToMarkdownResult = { markdown: string } | { tooLarge: true; name: string };

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

// Images are downscaled (see imageResize.ts) before the size check below, so
// a big-but-shrinkable photo/screenshot embeds instead of being rejected —
// `tooLarge` now only fires when even the downscaled image (or a non-image
// file, which isn't resized at all) is still over the cap.
export async function fileToMarkdown(file: File): Promise<FileToMarkdownResult> {
  const isImage = file.type.startsWith("image/");
  const embed = isImage ? await resizeImageFile(file) : file;
  if (embed.size > MAX_EMBED_BYTES) return { tooLarge: true, name: file.name };
  const dataUrl = await readAsDataUrl(embed);
  // "]" would prematurely close the markdown alt/link text.
  const label = file.name.replace(/[[\]]/g, "");
  return { markdown: isImage ? `![${label}](${dataUrl})` : `[${label}](${dataUrl})` };
}

// Generic (or empty) filenames the browser assigns a clipboard image that
// never had a real file behind it — replaced with a readable, timestamped
// label so a pasted screenshot's alt text isn't blank, or identical across
// every screenshot pasted into the note. Filenames that already look
// meaningful (a real dropped file, or an unusual clipboard name) pass
// through untouched.
const GENERIC_IMAGE_NAMES = new Set(["", "image.png", "image.jpg", "image.jpeg", "image.gif", "image.webp"]);

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Pure label logic behind renameGenericClipboardImage — `now` is injected
 *  so it can be unit-tested deterministically. */
export function labelForClipboardImage(name: string, mimeType: string, now: Date): string {
  if (!GENERIC_IMAGE_NAMES.has(name.toLowerCase())) return name;
  const ext = EXT_BY_MIME[mimeType] ?? "png";
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `Pasted image ${stamp}.${ext}`;
}

// Used by the clipboard-paste path (see BlockEditor.tsx's handleImagePaste)
// before handing the file to the same embed pipeline fileToMarkdown/drop
// uses, so a pasted screenshot gets a readable alt label instead of
// "image.png" (or nothing at all).
export function renameGenericClipboardImage(file: File, now: Date = new Date()): File {
  const label = labelForClipboardImage(file.name, file.type, now);
  return label === file.name ? file : new File([file], label, { type: file.type, lastModified: file.lastModified });
}

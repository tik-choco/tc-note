// Downscales an image File before it's embedded as a data: URL (see
// files.ts) -- a modern screenshot easily exceeds the inline-embed size cap,
// so pasting/dropping one should shrink it instead of being rejected
// outright. The sizing/format decisions below are pure and unit-tested under
// Vitest's default node environment (no DOM, no canvas); only the thin
// wrapper at the bottom touches createImageBitmap/<canvas>, and degrades to
// "keep the original" whenever that machinery is unavailable, unhelpful, or
// throws -- callers (files.ts) only need to compare the returned size against
// their own embed cap.

/** Longest edge, in pixels, an embedded image is downscaled to. */
export const MAX_EDGE = 1600;
/** Re-encode quality for the WebP/JPEG output (0..1). */
export const ENCODE_QUALITY = 0.82;
/** Below this size, resizing/re-encoding isn't worth the decode/draw/encode
 *  round trip -- the file is left exactly as-is. */
export const SKIP_RESIZE_BELOW_BYTES = 512 * 1024;

/** Scales (width, height) down so the longer edge is at most `maxEdge`,
 *  preserving aspect ratio -- this only ever shrinks. Dimensions already
 *  within bounds (or degenerate input) pass through unchanged. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (width <= 0 || height <= 0 || maxEdge <= 0) return { width, height };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** False for formats a canvas round-trip would harm rather than help:
 *  animated GIF loses its animation (canvas only ever captures one frame),
 *  and SVG is already tiny, resolution-independent vector markup --
 *  rasterizing it is a pure downgrade. Both skip resizing entirely and keep
 *  the original bytes. */
export function isResizableImageType(mimeType: string): boolean {
  return mimeType.startsWith("image/") && mimeType !== "image/gif" && mimeType !== "image/svg+xml";
}

/** True when `bytes` is already small enough that attempting to resize
 *  wouldn't be worth the decode/draw/encode round trip. */
export function isAlreadySmall(bytes: number, thresholdBytes: number = SKIP_RESIZE_BELOW_BYTES): boolean {
  return bytes <= thresholdBytes;
}

/** Whether a re-encoded candidate is actually worth keeping over the
 *  original -- re-encoding can end up *larger* for some inputs (e.g. a
 *  flat-color screenshot PNG already compresses well), so this is the one
 *  source of truth for "did shrinking help" rather than assuming the
 *  encoder always wins. Never returns true for a same-or-bigger candidate. */
export function isSmallerThanOriginal(candidateBytes: number, originalBytes: number): boolean {
  return candidateBytes > 0 && candidateBytes < originalBytes;
}

/** File extension matching a re-encoded image's actual output format. */
export function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/jpeg") return "jpg";
  return "png";
}

/** Swaps `name`'s extension for one matching `mimeType` -- used after
 *  re-encoding actually changes the format, e.g. "photo.png" + image/webp ->
 *  "photo.webp". A name with no extension gets one appended; an empty name
 *  falls back to "image". */
export function renameForMimeType(name: string, mimeType: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "image";
  return `${base}.${extensionForMimeType(mimeType)}`;
}

// --- DOM wrapper below this point -- not exercised by the (node-environment) unit tests ---

function encodeCanvas(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Downscales/re-encodes an image file for inline embedding: draws it to a
 *  canvas at a bounded size (see fitWithin/MAX_EDGE) and re-encodes as WebP,
 *  falling back to JPEG when the browser can't actually produce WebP blobs
 *  (canvas.toBlob silently substitutes PNG for an unsupported type, which
 *  shows up as a mismatched `blob.type`). Returns the original file
 *  unchanged whenever resizing isn't applicable (non-image, GIF/SVG,
 *  already small), wouldn't help (the re-encoded candidate isn't actually
 *  smaller), or canvas/createImageBitmap is unavailable or throws -- this
 *  never makes the output bigger than the input. */
export async function resizeImageFile(file: File, maxEdge: number = MAX_EDGE): Promise<File> {
  if (!isResizableImageType(file.type) || isAlreadySmall(file.size)) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      // Flatten onto white first: JPEG has no alpha channel, and this keeps
      // the WebP and JPEG outputs visually consistent for any image with
      // transparency instead of the JPEG fallback silently going black.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);

      let blob = await encodeCanvas(canvas, "image/webp", ENCODE_QUALITY);
      let type = "image/webp";
      if (!blob || blob.type !== "image/webp") {
        blob = await encodeCanvas(canvas, "image/jpeg", ENCODE_QUALITY);
        type = "image/jpeg";
      }
      if (!blob || !isSmallerThanOriginal(blob.size, file.size)) return file;
      return new File([blob], renameForMimeType(file.name, type), { type, lastModified: file.lastModified });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

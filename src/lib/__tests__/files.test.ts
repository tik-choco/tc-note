import { describe, it, expect } from "vitest";
import { fileToMarkdown, labelForClipboardImage, renameGenericClipboardImage } from "../files";

// Vitest here runs in the default node environment (no DOM/canvas), so
// resizeImageFile's canvas path always no-ops and returns the file
// unchanged (see imageResize.test.ts for that fallback's own coverage) —
// which is exactly what lets these tests exercise fileToMarkdown's actual
// result contract deterministically.
//
// Node has Blob/File (via undici) but, unlike a browser, no FileReader —
// fileToMarkdown's accept path needs one to turn the (possibly resized)
// blob into a data: URL, so this is a minimal test-only stand-in built on
// Blob.arrayBuffer(), which Node does have. Production code is untouched;
// this only patches the global for this test file.
class FakeFileReader {
  result: string | null = null;
  error: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(blob: Blob) {
    blob
      .arrayBuffer()
      .then((buf) => {
        let binary = "";
        for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte);
        this.result = `data:${blob.type};base64,${btoa(binary)}`;
        this.onload?.();
      })
      .catch((err) => {
        this.error = err;
        this.onerror?.();
      });
  }
}
(globalThis as unknown as { FileReader: typeof FakeFileReader }).FileReader = FakeFileReader;

describe("fileToMarkdown", () => {
  it("embeds a small image as a markdown image with a data: URL", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" });
    const result = await fileToMarkdown(file);
    expect("markdown" in result).toBe(true);
    if ("markdown" in result) {
      expect(result.markdown.startsWith("![photo.png](data:image/png")).toBe(true);
    }
  });

  it("embeds a non-image file as a markdown link, not an image", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" });
    const result = await fileToMarkdown(file);
    expect("markdown" in result).toBe(true);
    if ("markdown" in result) {
      expect(result.markdown.startsWith("[notes.txt](data:")).toBe(true);
      expect(result.markdown.startsWith("![")).toBe(false);
    }
  });

  it("strips ']' from the label so it can't prematurely close the markdown syntax", async () => {
    const file = new File([new Uint8Array([1])], "weird]name.png", { type: "image/png" });
    const result = await fileToMarkdown(file);
    if ("markdown" in result) {
      expect(result.markdown.startsWith("![weirdname.png](")).toBe(true);
    } else {
      throw new Error("expected markdown result");
    }
  });

  it("reports tooLarge (with the original name) for an oversized non-image file", async () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    const file = new File([big], "archive.zip", { type: "application/zip" });
    const result = await fileToMarkdown(file);
    expect(result).toEqual({ tooLarge: true, name: "archive.zip" });
  });

  it("reports tooLarge for an oversized image that resizing can't help with (no canvas here)", async () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    const file = new File([big], "huge.png", { type: "image/png" });
    const result = await fileToMarkdown(file);
    expect(result).toEqual({ tooLarge: true, name: "huge.png" });
  });

  it("keeps a right-at-the-cap file", async () => {
    const atCap = new Uint8Array(4 * 1024 * 1024);
    const file = new File([atCap], "ok.png", { type: "image/png" });
    const result = await fileToMarkdown(file);
    expect("tooLarge" in result).toBe(false);
  });
});

describe("labelForClipboardImage", () => {
  const now = new Date(2026, 6, 30, 9, 5, 3); // 2026-07-30 09:05:03 local

  it("passes through a meaningful filename untouched", () => {
    expect(labelForClipboardImage("vacation-photo.jpg", "image/jpeg", now)).toBe("vacation-photo.jpg");
  });

  it("replaces a generic browser-assigned name with a timestamped label", () => {
    expect(labelForClipboardImage("image.png", "image/png", now)).toBe("Pasted image 2026-07-30 090503.png");
  });

  it("replaces an empty name (some browsers give clipboard images none)", () => {
    expect(labelForClipboardImage("", "image/png", now)).toBe("Pasted image 2026-07-30 090503.png");
  });

  it("is case-insensitive when matching generic names", () => {
    expect(labelForClipboardImage("IMAGE.PNG", "image/png", now)).toBe("Pasted image 2026-07-30 090503.png");
  });

  it("picks the extension from the mime type, not the (generic) original name", () => {
    expect(labelForClipboardImage("image.png", "image/webp", now)).toBe("Pasted image 2026-07-30 090503.webp");
  });

  it("zero-pads month/day/time components", () => {
    const earlyMoment = new Date(2026, 0, 5, 3, 2, 1); // 2026-01-05 03:02:01
    expect(labelForClipboardImage("", "image/gif", earlyMoment)).toBe("Pasted image 2026-01-05 030201.gif");
  });
});

describe("renameGenericClipboardImage", () => {
  it("returns the exact same File instance when the name is already meaningful", () => {
    const file = new File([new Uint8Array([1])], "screenshot-2026.png", { type: "image/png" });
    expect(renameGenericClipboardImage(file, new Date())).toBe(file);
  });

  it("returns a renamed File (same bytes/type) for a generic clipboard name", () => {
    const file = new File([new Uint8Array([9, 9])], "image.png", { type: "image/png" });
    const renamed = renameGenericClipboardImage(file, new Date(2026, 6, 30, 12, 0, 0));
    expect(renamed).not.toBe(file);
    expect(renamed.name).toBe("Pasted image 2026-07-30 120000.png");
    expect(renamed.type).toBe("image/png");
    expect(renamed.size).toBe(file.size);
  });
});

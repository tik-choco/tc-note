import { describe, it, expect } from "vitest";
import {
  MAX_EDGE,
  SKIP_RESIZE_BELOW_BYTES,
  fitWithin,
  isResizableImageType,
  isAlreadySmall,
  isSmallerThanOriginal,
  extensionForMimeType,
  renameForMimeType,
  resizeImageFile,
} from "../imageResize";

describe("fitWithin", () => {
  it("leaves dimensions unchanged when already within bounds", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("leaves dimensions unchanged when the longer edge exactly equals maxEdge", () => {
    expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });

  it("scales a landscape image down so the width matches maxEdge", () => {
    // 3200x1800 -> longest edge (width) scaled to 1600, height halves too.
    expect(fitWithin(3200, 1800, 1600)).toEqual({ width: 1600, height: 900 });
  });

  it("scales a portrait image down so the height matches maxEdge", () => {
    // 1800x3200 -> longest edge (height) scaled to 1600, width halves too.
    expect(fitWithin(1800, 3200, 1600)).toEqual({ width: 900, height: 1600 });
  });

  it("preserves aspect ratio for a non-round scale factor", () => {
    const r = fitWithin(5000, 3000, 1600);
    expect(r.width).toBe(1600);
    // 3000 * (1600/5000) = 960
    expect(r.height).toBe(960);
  });

  it("never produces a zero dimension for an extreme aspect ratio", () => {
    const r = fitWithin(10000, 1, 1600);
    expect(r.width).toBe(1600);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it("passes through degenerate (zero/negative) input unchanged", () => {
    expect(fitWithin(0, 100, 1600)).toEqual({ width: 0, height: 100 });
    expect(fitWithin(100, -5, 1600)).toEqual({ width: 100, height: -5 });
    expect(fitWithin(100, 100, 0)).toEqual({ width: 100, height: 100 });
  });

  it("uses the exported MAX_EDGE default sensibly", () => {
    expect(MAX_EDGE).toBeGreaterThan(0);
    expect(fitWithin(MAX_EDGE * 2, MAX_EDGE * 2, MAX_EDGE)).toEqual({ width: MAX_EDGE, height: MAX_EDGE });
  });
});

describe("isResizableImageType", () => {
  it("accepts common raster image types", () => {
    expect(isResizableImageType("image/png")).toBe(true);
    expect(isResizableImageType("image/jpeg")).toBe(true);
    expect(isResizableImageType("image/webp")).toBe(true);
  });

  it("rejects animated GIF (canvas would freeze it to one frame)", () => {
    expect(isResizableImageType("image/gif")).toBe(false);
  });

  it("rejects SVG (vector, rasterizing is a downgrade)", () => {
    expect(isResizableImageType("image/svg+xml")).toBe(false);
  });

  it("rejects non-image mime types", () => {
    expect(isResizableImageType("application/pdf")).toBe(false);
    expect(isResizableImageType("text/plain")).toBe(false);
    expect(isResizableImageType("")).toBe(false);
  });
});

describe("isAlreadySmall", () => {
  it("is true at and below the default threshold", () => {
    expect(isAlreadySmall(SKIP_RESIZE_BELOW_BYTES)).toBe(true);
    expect(isAlreadySmall(0)).toBe(true);
  });

  it("is false above the default threshold", () => {
    expect(isAlreadySmall(SKIP_RESIZE_BELOW_BYTES + 1)).toBe(false);
  });

  it("respects an explicit threshold override", () => {
    expect(isAlreadySmall(500, 1000)).toBe(true);
    expect(isAlreadySmall(1500, 1000)).toBe(false);
  });
});

describe("isSmallerThanOriginal", () => {
  it("is true for a strictly smaller, non-empty candidate", () => {
    expect(isSmallerThanOriginal(100, 200)).toBe(true);
  });

  it("is false for an equal or larger candidate (never make it bigger)", () => {
    expect(isSmallerThanOriginal(200, 200)).toBe(false);
    expect(isSmallerThanOriginal(300, 200)).toBe(false);
  });

  it("is false for a zero-byte candidate (treated as a failed encode)", () => {
    expect(isSmallerThanOriginal(0, 200)).toBe(false);
  });
});

describe("extensionForMimeType / renameForMimeType", () => {
  it("maps known re-encode targets to their extension", () => {
    expect(extensionForMimeType("image/webp")).toBe("webp");
    expect(extensionForMimeType("image/jpeg")).toBe("jpg");
  });

  it("falls back to png for anything else", () => {
    expect(extensionForMimeType("image/png")).toBe("png");
    expect(extensionForMimeType("image/bmp")).toBe("png");
  });

  it("swaps an existing extension", () => {
    expect(renameForMimeType("photo.png", "image/webp")).toBe("photo.webp");
    expect(renameForMimeType("IMG_1234.HEIC", "image/jpeg")).toBe("IMG_1234.jpg");
  });

  it("appends an extension to a name that has none", () => {
    expect(renameForMimeType("screenshot", "image/webp")).toBe("screenshot.webp");
  });

  it("falls back to a generic base name for an empty name", () => {
    expect(renameForMimeType("", "image/jpeg")).toBe("image.jpg");
  });

  it("only strips the final extension, not dots earlier in the name", () => {
    expect(renameForMimeType("v1.2.screenshot.png", "image/webp")).toBe("v1.2.screenshot.webp");
  });
});

describe("resizeImageFile — graceful degradation without DOM/canvas", () => {
  // Vitest here runs in the default node environment: no `document`, so this
  // exercises the actual "canvas unavailable" fallback path, not a mock of it.
  it("returns the original file unchanged when canvas/document is unavailable", async () => {
    const file = new File([new Uint8Array(SKIP_RESIZE_BELOW_BYTES + 1)], "big.png", { type: "image/png" });
    const result = await resizeImageFile(file);
    expect(result).toBe(file);
  });

  it("returns the original file unchanged when it is already small", async () => {
    const file = new File([new Uint8Array(10)], "tiny.png", { type: "image/png" });
    const result = await resizeImageFile(file);
    expect(result).toBe(file);
  });

  it("returns the original file unchanged for a non-resizable type (gif)", async () => {
    const file = new File([new Uint8Array(SKIP_RESIZE_BELOW_BYTES + 1)], "anim.gif", { type: "image/gif" });
    const result = await resizeImageFile(file);
    expect(result).toBe(file);
  });
});

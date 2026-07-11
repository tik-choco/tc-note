import { describe, it, expect } from "vitest";
import { appendInboxItem, parseExistingItems, type DriveInboxItem } from "../storageDriveInbox";

function makeItem(id: string): DriveInboxItem {
  return {
    id,
    name: `${id}.txt`,
    mimeType: "text/plain",
    size: 4,
    checksum: `checksum-${id}`,
    cid: `cid-${id}`,
    key: "a2V5",
    iv: "aXY=",
    addedAt: "2026-07-10T00:00:00.000Z",
  };
}

describe("appendInboxItem", () => {
  it("appends an item to an empty list", () => {
    const item = makeItem("a");
    expect(appendInboxItem([], item)).toEqual([item]);
  });

  it("caps the rolling list at the most recent 50 items", () => {
    const existing = Array.from({ length: 50 }, (_, i) => makeItem(`old-${i}`));
    const next = makeItem("new");
    const result = appendInboxItem(existing, next);
    expect(result).toHaveLength(50);
    expect(result[result.length - 1]).toEqual(next);
    expect(result[0]).toEqual(existing[1]);
    expect(result.find((entry) => entry.id === "old-0")).toBeUndefined();
  });
});

describe("parseExistingItems", () => {
  it("returns an empty list when meta is missing or has no items", () => {
    expect(parseExistingItems(undefined)).toEqual([]);
    expect(parseExistingItems({})).toEqual([]);
    expect(parseExistingItems({ items: "not-an-array" })).toEqual([]);
  });

  it("parses well-formed items", () => {
    const item = makeItem("a");
    expect(parseExistingItems({ items: [item] })).toEqual([item]);
  });

  it("skips malformed entries but keeps valid ones", () => {
    const good = makeItem("good");
    const meta = {
      items: [null, "not-an-object", { id: "missing-fields" }, good, { ...good, id: "bad-size", size: "not-a-number" }],
    };
    expect(parseExistingItems(meta)).toEqual([good]);
  });
});

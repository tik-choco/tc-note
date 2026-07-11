import { describe, it, expect } from "vitest";
import { reconcileBlockIds } from "../blockDiff";

function makeId(): () => string {
  let n = 0;
  return () => `new-${n++}`;
}

describe("reconcileBlockIds", () => {
  it("keeps ids and only writes changed content for a same-length edit", () => {
    const result = reconcileBlockIds(
      ["a", "b", "c"],
      ["one", "two", "three"],
      ["one", "TWO", "three"],
      makeId(),
    );
    expect(result.ids).toEqual(["a", "b", "c"]);
    expect(result.contentWrites).toEqual([{ id: "b", value: "TWO" }]);
    expect(result.orderOps).toEqual([]);
    expect(result.removedIds).toEqual([]);
  });

  it("assigns a fresh id and an insert op for a new block", () => {
    const result = reconcileBlockIds(
      ["a", "b"],
      ["one", "two"],
      ["one", "inserted", "two"],
      makeId(),
    );
    expect(result.ids).toEqual(["a", "new-0", "b"]);
    expect(result.contentWrites).toEqual([{ id: "new-0", value: "inserted" }]);
    expect(result.orderOps).toEqual([{ type: "insert", index: 1, ids: ["new-0"] }]);
    expect(result.removedIds).toEqual([]);
  });

  it("produces a delete op and drops the removed id for a deleted block", () => {
    const result = reconcileBlockIds(["a", "b", "c"], ["one", "two", "three"], ["one", "three"], makeId());
    expect(result.ids).toEqual(["a", "c"]);
    expect(result.contentWrites).toEqual([]);
    expect(result.orderOps).toEqual([{ type: "delete", index: 1, count: 1 }]);
    expect(result.removedIds).toEqual(["b"]);
  });

  it("splits one block into two (delete old, insert both new)", () => {
    const result = reconcileBlockIds(["a"], ["one two"], ["one", "two"], makeId());
    expect(result.ids).toEqual(["new-0", "new-1"]);
    expect(result.removedIds).toEqual(["a"]);
    expect(result.orderOps).toEqual([
      { type: "delete", index: 0, count: 1 },
      { type: "insert", index: 0, ids: ["new-0", "new-1"] },
    ]);
  });

  it("merges two blocks into one", () => {
    const result = reconcileBlockIds(["a", "b"], ["one", "two"], ["one two"], makeId());
    expect(result.ids).toEqual(["new-0"]);
    expect(result.removedIds).toEqual(["a", "b"]);
    expect(result.orderOps).toEqual([
      { type: "delete", index: 0, count: 2 },
      { type: "insert", index: 0, ids: ["new-0"] },
    ]);
  });
});

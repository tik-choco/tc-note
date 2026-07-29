import { describe, expect, it } from "vitest";
import { preserveActiveEdit, resolveTargetRoom } from "../useCollab";

// The active-block preservation rule a remote doc update goes through in
// applyDocToLocalState. The hook itself can't be rendered under this project's
// DOM-less test setup, so the contract is pinned down here on the pure helper.
// The bug this guards: the helper must read the *current* active block / local
// value (the hook now feeds it live refs), and it must match the edited block
// by stable id, not array index, so a peer's edit can't stomp in-progress
// keystrokes or land on the wrong (shifted) block.
describe("preserveActiveEdit", () => {
  it("keeps the local in-progress value in the actively edited block", () => {
    // User is editing block index 1 ("id-b"); they've typed "world!" but the
    // last synced value was "world". The remote update carries "REMOTE" there.
    const result = preserveActiveEdit(
      ["hello", "REMOTE"], // remoteBlocks
      ["id-a", "id-b"], // remoteIds
      1, // activeIndex
      ["id-a", "id-b"], // localIds
      ["hello", "world!"], // localValues (on screen now)
      ["hello", "world"], // lastSyncedValues
    );
    expect(result).toEqual(["hello", "world!"]);
  });

  it("matches the active block by id, not index, when a peer inserted above it", () => {
    // A peer inserted a new first block, so the block the user is editing
    // ("id-b") moved from local index 1 to remote index 2 — the local value
    // must be preserved at its *new* position, not the old index.
    const result = preserveActiveEdit(
      ["inserted", "hello", "REMOTE"], // remoteBlocks
      ["id-x", "id-a", "id-b"], // remoteIds (id-b now at index 2)
      1, // activeIndex (local index of id-b)
      ["id-a", "id-b"], // localIds
      ["hello", "mine"], // localValues
      ["hello", "synced"], // lastSyncedValues
    );
    expect(result).toEqual(["inserted", "hello", "mine"]);
  });

  it("lets an untouched active block pick up the remote edit", () => {
    // Local value equals what was last synced — nothing unsaved to protect, so
    // the remote edit is applied even though this block is 'active'.
    const result = preserveActiveEdit(
      ["hello", "REMOTE"],
      ["id-a", "id-b"],
      1,
      ["id-a", "id-b"],
      ["hello", "same"],
      ["hello", "same"],
    );
    expect(result).toEqual(["hello", "REMOTE"]);
  });

  it("returns the remote blocks unchanged when no block is active", () => {
    const remote = ["hello", "world"];
    expect(preserveActiveEdit(remote, ["id-a", "id-b"], null, ["id-a", "id-b"], ["x", "y"], ["a", "b"])).toBe(
      remote,
    );
  });

  it("does not preserve when the active block id no longer exists remotely", () => {
    // A peer deleted the block the user was editing — there's no target slot
    // to hold the local value in, so the remote result stands unchanged.
    const remote = ["hello"];
    const result = preserveActiveEdit(remote, ["id-a"], 1, ["id-a", "id-b"], ["hello", "gone"], ["hello", "was"]);
    expect(result).toBe(remote);
  });

  it("ignores an active index past the end of the local id list", () => {
    const remote = ["hello"];
    expect(preserveActiveEdit(remote, ["id-a"], 3, ["id-a"], ["hello"], ["hello"])).toBe(remote);
  });
});

// Room membership is resolved per note, from scratch, every time the active
// note changes. The bug this guards: membership used to persist across note
// switches (a manual share stayed joined while the user browsed other notes,
// and every note in a shared folder joined the folder's single room), which
// made unrelated notes look — and behave — like they were being co-edited.
describe("resolveTargetRoom", () => {
  const noRooms = new Map<string, string>();

  it("puts a note with no manual room and no shared folder in no room at all", () => {
    expect(resolveTargetRoom("note-a", null, noRooms)).toEqual({ roomId: null, source: null });
  });

  it("uses the folder-derived room when the note's folder is shared", () => {
    expect(resolveTargetRoom("note-a", "folder-room-a", noRooms)).toEqual({
      roomId: "folder-room-a",
      source: "folder",
    });
  });

  it("prefers an explicit join over the folder's room for that note", () => {
    const manual = new Map([["note-a", "manual-room"]]);
    expect(resolveTargetRoom("note-a", "folder-room-a", manual)).toEqual({
      roomId: "manual-room",
      source: "manual",
    });
  });

  it("does not carry another note's manual room onto the note now open", () => {
    // Shared note-a, then opened note-b: note-b is unfiled and was never
    // shared, so it must resolve to no room rather than inheriting the session.
    const manual = new Map([["note-a", "manual-room"]]);
    expect(resolveTargetRoom("note-b", null, manual)).toEqual({ roomId: null, source: null });
  });

  it("falls back to the folder room for a note the user never shared manually", () => {
    const manual = new Map([["note-a", "manual-room"]]);
    expect(resolveTargetRoom("note-b", "folder-room-b", manual)).toEqual({
      roomId: "folder-room-b",
      source: "folder",
    });
  });

  it("rejoins a note's own manual room when the user comes back to it", () => {
    const manual = new Map([["note-a", "manual-room"]]);
    expect(resolveTargetRoom("note-a", null, manual)).toEqual({
      roomId: "manual-room",
      source: "manual",
    });
  });
});

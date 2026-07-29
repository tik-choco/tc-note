// The rule behind the sidebar's per-note sharing dot. Sharing reaches a note
// from two directions (its folder, or an explicit share of the note itself),
// so this pins down which one a row reports when several apply at once — the
// row only ever shows one marker.
import { describe, expect, it } from "vitest";
import { noteShareState, type Folder } from "../mistlib";

const SHARED_FOLDER: Folder = { id: "f1", name: "Shared", parentId: null, roomId: "room-f1" };
const PLAIN_FOLDER: Folder = { id: "f2", name: "Plain", parentId: null, roomId: null };
const FOLDERS = [SHARED_FOLDER, PLAIN_FOLDER];

const none: ReadonlySet<string> = new Set();

describe("noteShareState", () => {
  it("reports an unfiled, never-shared note as local", () => {
    expect(noteShareState({ id: "n1", folderId: null }, FOLDERS, none, null)).toBe("local");
  });

  it("reports a note in an unshared folder as local", () => {
    expect(noteShareState({ id: "n1", folderId: "f2" }, FOLDERS, none, null)).toBe("local");
  });

  it("reports a note in a shared folder as folder-shared", () => {
    expect(noteShareState({ id: "n1", folderId: "f1" }, FOLDERS, none, null)).toBe("folder");
  });

  it("reports an explicitly shared note as manual", () => {
    expect(noteShareState({ id: "n1", folderId: null }, FOLDERS, new Set(["n1"]), null)).toBe("manual");
  });

  it("reports the connected note as live", () => {
    expect(noteShareState({ id: "n1", folderId: null }, FOLDERS, new Set(["n1"]), "n1")).toBe("live");
  });

  it("prefers live over the folder it happens to sit in", () => {
    expect(noteShareState({ id: "n1", folderId: "f1" }, FOLDERS, none, "n1")).toBe("live");
  });

  it("prefers an explicit share over the note's folder", () => {
    expect(noteShareState({ id: "n1", folderId: "f1" }, FOLDERS, new Set(["n1"]), null)).toBe("manual");
  });

  it("does not mark a note whose folder id no longer resolves", () => {
    // A folder can be deleted while its notes are being re-filed — a dangling
    // folderId must not be read as "shared" on the strength of the id alone.
    expect(noteShareState({ id: "n1", folderId: "gone" }, FOLDERS, none, null)).toBe("local");
  });

  it("only marks the connected note as live, not its neighbours", () => {
    expect(noteShareState({ id: "n2", folderId: "f1" }, FOLDERS, none, "n1")).toBe("folder");
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Folder, NoteMeta } from "../mistlib";

// Same style as noteInbox.test.ts: mock mistlib's public surface directly
// rather than the underlying wasm store, since noteBackup.ts only talks to
// mistlib through saveNote/setNoteFolder/createFolder/listNotes/loadNote/
// listFolders/toggleFavorite.
const { listNotes, loadNote, listFolders, saveNote, setNoteFolder, createFolder, toggleFavorite } = vi.hoisted(() => ({
  listNotes: vi.fn(),
  loadNote: vi.fn(),
  listFolders: vi.fn(),
  saveNote: vi.fn(),
  setNoteFolder: vi.fn(),
  createFolder: vi.fn(),
  toggleFavorite: vi.fn(),
}));
vi.mock("../mistlib", () => ({ listNotes, loadNote, listFolders, saveNote, setNoteFolder, createFolder, toggleFavorite }));

import {
  BACKUP_SCHEMA,
  BACKUP_VERSION,
  applyBackup,
  buildBackup,
  parseBackup,
  planFolderImport,
  planNoteImport,
  type BackupFolder,
  type BackupNote,
  type NoteBackup,
} from "../noteBackup";

function validBackupJson(overrides: Partial<NoteBackup> = {}): string {
  const backup: NoteBackup = {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: "2026-07-30T00:00:00.000Z",
    folders: [{ id: "f1", name: "Work", parentId: null }],
    notes: [
      {
        id: "n1",
        title: "Hello",
        markdown: "# Hello\n\nworld",
        folderId: "f1",
        favorite: true,
        updatedAt: 1700000000000,
      },
    ],
    ...overrides,
  };
  return JSON.stringify(backup);
}

function noteMeta(id: string, overrides: Partial<NoteMeta> = {}): NoteMeta {
  return {
    id,
    title: id,
    cid: `cid-${id}`,
    updatedAt: 0,
    favorite: false,
    preview: "",
    folderId: null,
    ...overrides,
  };
}

function folder(id: string, name: string, parentId: string | null = null): Folder {
  return { id, name, parentId };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseBackup", () => {
  it("accepts a well-formed backup", () => {
    const result = parseBackup(validBackupJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.schema).toBe(BACKUP_SCHEMA);
    expect(result.backup.version).toBe(BACKUP_VERSION);
    expect(result.backup.folders).toEqual([{ id: "f1", name: "Work", parentId: null }]);
    expect(result.backup.notes).toEqual([
      { id: "n1", title: "Hello", markdown: "# Hello\n\nworld", folderId: "f1", favorite: true, updatedAt: 1700000000000 },
    ]);
  });

  it("accepts empty folders/notes arrays", () => {
    const result = parseBackup(validBackupJson({ folders: [], notes: [] }));
    expect(result.ok).toBe(true);
  });

  it("rejects an empty string", () => {
    const result = parseBackup("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/JSON/i);
  });

  it("rejects non-JSON text", () => {
    const result = parseBackup("not json at all {{{");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/JSON/i);
  });

  it("rejects a bare JSON array instead of an object", () => {
    const result = parseBackup(JSON.stringify([1, 2, 3]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/object/i);
  });

  it("rejects a bare JSON primitive", () => {
    expect(parseBackup("42").ok).toBe(false);
    expect(parseBackup("null").ok).toBe(false);
    expect(parseBackup('"just a string"').ok).toBe(false);
  });

  it("rejects an unrelated JSON object (wrong schema id)", () => {
    const result = parseBackup(JSON.stringify({ schema: "some-other-app-export", version: 1, exportedAt: "x", folders: [], notes: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/schema/i);
  });

  it("rejects a missing schema field", () => {
    const result = parseBackup(JSON.stringify({ version: 1, exportedAt: "x", folders: [], notes: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/schema/i);
  });

  it("rejects a wrong/future version", () => {
    const result = parseBackup(validBackupJson({ version: 2 as typeof BACKUP_VERSION }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/version/i);
  });

  it("rejects a non-numeric version", () => {
    const raw = JSON.parse(validBackupJson());
    raw.version = "1";
    expect(parseBackup(JSON.stringify(raw)).ok).toBe(false);
  });

  it("rejects a missing exportedAt", () => {
    const raw = JSON.parse(validBackupJson());
    delete raw.exportedAt;
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/exportedAt/);
  });

  it("rejects a missing folders array", () => {
    const raw = JSON.parse(validBackupJson());
    delete raw.folders;
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/folders/);
  });

  it("rejects folders that is not an array", () => {
    const raw = JSON.parse(validBackupJson());
    raw.folders = { not: "an array" };
    expect(parseBackup(JSON.stringify(raw)).ok).toBe(false);
  });

  it("rejects a missing notes array", () => {
    const raw = JSON.parse(validBackupJson());
    delete raw.notes;
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/notes/);
  });

  it("rejects a folder entry missing required fields", () => {
    const raw = JSON.parse(validBackupJson());
    raw.folders = [{ id: "f1" }]; // missing name
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/folders\[0\]/);
  });

  it("rejects a folder entry with wrong-typed fields", () => {
    const raw = JSON.parse(validBackupJson());
    raw.folders = [{ id: 123, name: "Work", parentId: null }];
    expect(parseBackup(JSON.stringify(raw)).ok).toBe(false);
  });

  it("rejects a folder entry with a non-string/non-null parentId", () => {
    const raw = JSON.parse(validBackupJson());
    raw.folders = [{ id: "f1", name: "Work", parentId: 5 }];
    expect(parseBackup(JSON.stringify(raw)).ok).toBe(false);
  });

  it("rejects a note entry missing required fields", () => {
    const raw = JSON.parse(validBackupJson());
    raw.notes = [{ id: "n1", title: "Hello" }]; // missing markdown/folderId/favorite/updatedAt
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/notes\[0\]/);
  });

  it("rejects a note entry with wrong-typed fields", () => {
    const base = JSON.parse(validBackupJson());

    const wrongMarkdown = { ...base, notes: [{ ...base.notes[0], markdown: 12345 }] };
    expect(parseBackup(JSON.stringify(wrongMarkdown)).ok).toBe(false);

    const wrongFavorite = { ...base, notes: [{ ...base.notes[0], favorite: "yes" }] };
    expect(parseBackup(JSON.stringify(wrongFavorite)).ok).toBe(false);

    const wrongUpdatedAt = { ...base, notes: [{ ...base.notes[0], updatedAt: "yesterday" }] };
    expect(parseBackup(JSON.stringify(wrongUpdatedAt)).ok).toBe(false);

    const wrongFolderId = { ...base, notes: [{ ...base.notes[0], folderId: 42 }] };
    expect(parseBackup(JSON.stringify(wrongFolderId)).ok).toBe(false);
  });

  it("rejects a note/folder array entry that is not an object", () => {
    const base = JSON.parse(validBackupJson());
    const notANoteObject = { ...base, notes: ["just a string"] };
    expect(parseBackup(JSON.stringify(notANoteObject)).ok).toBe(false);

    const notAFolderObject = { ...base, folders: [null] };
    expect(parseBackup(JSON.stringify(notAFolderObject)).ok).toBe(false);
  });

  it("accepts folderId: null on a note (unfiled)", () => {
    const raw = JSON.parse(validBackupJson());
    raw.notes[0].folderId = null;
    expect(parseBackup(JSON.stringify(raw)).ok).toBe(true);
  });

  it("never throws on arbitrary junk input", () => {
    const junk = [
      "",
      "   ",
      "{",
      "}",
      "[]",
      "{}",
      "undefined",
      "NaN",
      JSON.stringify({ schema: BACKUP_SCHEMA }),
      JSON.stringify({ schema: BACKUP_SCHEMA, version: BACKUP_VERSION }),
      JSON.stringify(12345),
      JSON.stringify(["a", "b"]),
      " binary-ish garbage￿",
      "{".repeat(1000),
    ];
    for (const text of junk) {
      expect(() => parseBackup(text)).not.toThrow();
      expect(parseBackup(text).ok).toBe(false);
    }
  });
});

describe("planFolderImport", () => {
  it("creates a folder that doesn't exist locally at all", () => {
    const plan = planFolderImport([{ id: "f1", name: "Work", parentId: null }], []);
    expect(plan).toEqual([{ backupId: "f1", action: "create", name: "Work", parentBackupId: null }]);
  });

  it("reuses an existing top-level folder matched by name", () => {
    const plan = planFolderImport([{ id: "f1", name: "Work", parentId: null }], [folder("local-1", "Work", null)]);
    expect(plan).toEqual([{ backupId: "f1", action: "reuse", localId: "local-1" }]);
  });

  it("does not match folders with the same name but a different parent", () => {
    const plan = planFolderImport(
      [{ id: "f1", name: "Work", parentId: null }],
      [folder("local-1", "Work", "some-other-parent")],
    );
    expect(plan).toEqual([{ backupId: "f1", action: "create", name: "Work", parentBackupId: null }]);
  });

  it("resolves a nested chain: reuses the existing parent, creates the missing child under it", () => {
    const backupFolders: BackupFolder[] = [
      { id: "parent", name: "Work", parentId: null },
      { id: "child", name: "Projects", parentId: "parent" },
    ];
    const existing = [folder("local-parent", "Work", null)];
    const plan = planFolderImport(backupFolders, existing);

    expect(plan).toEqual([
      { backupId: "parent", action: "reuse", localId: "local-parent" },
      { backupId: "child", action: "create", name: "Projects", parentBackupId: "parent" },
    ]);
  });

  it("creates a whole new subtree when the parent doesn't exist either, parent before child", () => {
    const backupFolders: BackupFolder[] = [
      { id: "parent", name: "Work", parentId: null },
      { id: "child", name: "Projects", parentId: "parent" },
    ];
    const plan = planFolderImport(backupFolders, []);

    expect(plan[0]).toEqual({ backupId: "parent", action: "create", name: "Work", parentBackupId: null });
    expect(plan[1]).toEqual({ backupId: "child", action: "create", name: "Projects", parentBackupId: "parent" });
  });

  it("reuses a whole existing subtree (grandparent/parent/child all matched)", () => {
    const backupFolders: BackupFolder[] = [
      { id: "a", name: "A", parentId: null },
      { id: "b", name: "B", parentId: "a" },
      { id: "c", name: "C", parentId: "b" },
    ];
    const existing = [folder("la", "A", null), folder("lb", "B", "la"), folder("lc", "C", "lb")];
    const plan = planFolderImport(backupFolders, existing);

    expect(plan).toEqual([
      { backupId: "a", action: "reuse", localId: "la" },
      { backupId: "b", action: "reuse", localId: "lb" },
      { backupId: "c", action: "reuse", localId: "lc" },
    ]);
  });

  it("treats a dangling parentId reference (parent not present in this backup) as top-level", () => {
    const plan = planFolderImport([{ id: "f1", name: "Orphan", parentId: "does-not-exist" }], []);
    expect(plan).toEqual([{ backupId: "f1", action: "create", name: "Orphan", parentBackupId: null }]);
  });

  it("breaks a parent cycle instead of infinite-looping", () => {
    const backupFolders: BackupFolder[] = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ];
    expect(() => planFolderImport(backupFolders, [])).not.toThrow();
    const plan = planFolderImport(backupFolders, []);
    expect(plan).toHaveLength(2);
    // Both must still resolve to *some* deterministic plan action, not loop forever.
    expect(plan.every((p) => p.action === "create" || p.action === "reuse")).toBe(true);
  });

  it("returns an empty plan for an empty backup", () => {
    expect(planFolderImport([], [folder("x", "Whatever", null)])).toEqual([]);
  });
});

describe("planNoteImport", () => {
  it("keeps the original id when it doesn't collide with an existing note", () => {
    const notes: BackupNote[] = [
      { id: "n1", title: "A", markdown: "a", folderId: null, favorite: false, updatedAt: 1 },
    ];
    const plan = planNoteImport(notes, []);
    expect(plan).toEqual([
      { backupId: "n1", targetId: "n1", collided: false, title: "A", markdown: "a", favorite: false, folderBackupId: null },
    ]);
  });

  it("assigns a fresh id when the backup note's id already exists locally", () => {
    const notes: BackupNote[] = [
      { id: "existing-id", title: "A", markdown: "a", folderId: null, favorite: false, updatedAt: 1 },
    ];
    const plan = planNoteImport(notes, [noteMeta("existing-id")]);
    expect(plan).toHaveLength(1);
    expect(plan[0].collided).toBe(true);
    expect(plan[0].targetId).not.toBe("existing-id");
    expect(typeof plan[0].targetId).toBe("string");
    expect(plan[0].targetId.length).toBeGreaterThan(0);
  });

  it("never produces a targetId that collides with an existing note", () => {
    const existing = [noteMeta("a"), noteMeta("b"), noteMeta("c")];
    const notes: BackupNote[] = [
      { id: "a", title: "A", markdown: "", folderId: null, favorite: false, updatedAt: 1 },
      { id: "b", title: "B", markdown: "", folderId: null, favorite: false, updatedAt: 1 },
    ];
    const plan = planNoteImport(notes, existing);
    for (const entry of plan) {
      expect(existing.some((n) => n.id === entry.targetId)).toBe(false);
    }
  });

  it("assigns distinct fresh ids when two backup notes share the same (colliding) id", () => {
    const notes: BackupNote[] = [
      { id: "dup", title: "First", markdown: "", folderId: null, favorite: false, updatedAt: 1 },
      { id: "dup", title: "Second", markdown: "", folderId: null, favorite: false, updatedAt: 2 },
    ];
    const plan = planNoteImport(notes, [noteMeta("dup")]);
    expect(plan).toHaveLength(2);
    expect(plan[0].targetId).not.toBe("dup");
    expect(plan[1].targetId).not.toBe("dup");
    expect(plan[0].targetId).not.toBe(plan[1].targetId);
  });

  it("preserves folderBackupId/favorite/title/markdown through the plan", () => {
    const notes: BackupNote[] = [
      { id: "n1", title: "Title", markdown: "body", folderId: "f1", favorite: true, updatedAt: 1 },
    ];
    const plan = planNoteImport(notes, []);
    expect(plan[0]).toMatchObject({ title: "Title", markdown: "body", folderBackupId: "f1", favorite: true });
  });
});

describe("buildBackup", () => {
  it("resolves every note's body and includes folders, notes, schema, version, exportedAt", async () => {
    listNotes.mockReturnValue([
      noteMeta("n1", { title: "One", folderId: "f1", favorite: true, updatedAt: 111 }),
      noteMeta("n2", { title: "Two", folderId: null, favorite: false, updatedAt: 222 }),
    ]);
    loadNote.mockImplementation(async (id: string) => `body of ${id}`);
    listFolders.mockReturnValue([folder("f1", "Work", null)]);

    const backup = await buildBackup();

    expect(backup.schema).toBe(BACKUP_SCHEMA);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(typeof backup.exportedAt).toBe("string");
    expect(backup.folders).toEqual([{ id: "f1", name: "Work", parentId: null }]);
    expect(backup.notes).toEqual([
      { id: "n1", title: "One", markdown: "body of n1", folderId: "f1", favorite: true, updatedAt: 111 },
      { id: "n2", title: "Two", markdown: "body of n2", folderId: null, favorite: false, updatedAt: 222 },
    ]);

    // Round-trips through parseBackup (i.e. buildBackup's output is itself a
    // valid backup file).
    const reparsed = parseBackup(JSON.stringify(backup));
    expect(reparsed.ok).toBe(true);
  });

  it("produces an empty-but-valid backup when there are no notes/folders", async () => {
    listNotes.mockReturnValue([]);
    listFolders.mockReturnValue([]);
    const backup = await buildBackup();
    expect(backup.notes).toEqual([]);
    expect(backup.folders).toEqual([]);
  });
});

describe("applyBackup", () => {
  it("creates missing folders, saves notes under their original ids, files them, and applies favorite", async () => {
    listFolders.mockReturnValue([]);
    listNotes.mockReturnValue([]);
    createFolder.mockImplementation((name: string, parentId: string | null) => ({ id: `local:${name}`, name, parentId }));
    saveNote.mockResolvedValue(undefined);

    const backup: NoteBackup = {
      schema: BACKUP_SCHEMA,
      version: BACKUP_VERSION,
      exportedAt: "2026-07-30T00:00:00.000Z",
      folders: [{ id: "f1", name: "Work", parentId: null }],
      notes: [{ id: "n1", title: "Hello", markdown: "world", folderId: "f1", favorite: true, updatedAt: 1 }],
    };

    const summary = await applyBackup(backup);

    expect(createFolder).toHaveBeenCalledWith("Work", null);
    expect(saveNote).toHaveBeenCalledWith("n1", "Hello", "world");
    expect(setNoteFolder).toHaveBeenCalledWith("n1", "local:Work");
    expect(toggleFavorite).toHaveBeenCalledWith("n1");
    expect(summary).toEqual({ notesImported: 1, notesSkipped: 0, foldersCreated: 1 });
  });

  it("reuses an existing folder instead of creating a duplicate", async () => {
    listFolders.mockReturnValue([folder("existing", "Work", null)]);
    listNotes.mockReturnValue([]);
    saveNote.mockResolvedValue(undefined);

    const backup: NoteBackup = {
      schema: BACKUP_SCHEMA,
      version: BACKUP_VERSION,
      exportedAt: "x",
      folders: [{ id: "f1", name: "Work", parentId: null }],
      notes: [{ id: "n1", title: "Hello", markdown: "world", folderId: "f1", favorite: false, updatedAt: 1 }],
    };

    const summary = await applyBackup(backup);

    expect(createFolder).not.toHaveBeenCalled();
    expect(setNoteFolder).toHaveBeenCalledWith("n1", "existing");
    expect(toggleFavorite).not.toHaveBeenCalled();
    expect(summary.foldersCreated).toBe(0);
  });

  it("never overwrites an existing note: a colliding id is imported under a fresh id", async () => {
    listFolders.mockReturnValue([]);
    listNotes.mockReturnValue([noteMeta("n1", { title: "Original, still here" })]);
    saveNote.mockResolvedValue(undefined);

    const backup: NoteBackup = {
      schema: BACKUP_SCHEMA,
      version: BACKUP_VERSION,
      exportedAt: "x",
      folders: [],
      notes: [{ id: "n1", title: "Imported copy", markdown: "imported body", folderId: null, favorite: false, updatedAt: 1 }],
    };

    const summary = await applyBackup(backup);

    expect(saveNote).toHaveBeenCalledTimes(1);
    const [savedId, savedTitle] = saveNote.mock.calls[0];
    expect(savedId).not.toBe("n1"); // must not reuse (and thus overwrite) the existing note's id
    expect(savedTitle).toBe("Imported copy");
    expect(summary.notesImported).toBe(1);
  });

  it("counts a per-note save failure as skipped rather than aborting the whole import", async () => {
    listFolders.mockReturnValue([]);
    listNotes.mockReturnValue([]);
    saveNote.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const backup: NoteBackup = {
      schema: BACKUP_SCHEMA,
      version: BACKUP_VERSION,
      exportedAt: "x",
      folders: [],
      notes: [
        { id: "bad", title: "Bad", markdown: "", folderId: null, favorite: false, updatedAt: 1 },
        { id: "good", title: "Good", markdown: "", folderId: null, favorite: false, updatedAt: 1 },
      ],
    };

    const summary = await applyBackup(backup);

    expect(summary).toEqual({ notesImported: 1, notesSkipped: 1, foldersCreated: 0 });
    errorSpy.mockRestore();
  });

  it("creates nested folders parent-before-child and files a note into the nested one", async () => {
    listFolders.mockReturnValue([]);
    listNotes.mockReturnValue([]);
    createFolder.mockImplementation((name: string, parentId: string | null) => ({
      id: `local:${name}:${parentId ?? "root"}`,
      name,
      parentId,
    }));
    saveNote.mockResolvedValue(undefined);

    const backup: NoteBackup = {
      schema: BACKUP_SCHEMA,
      version: BACKUP_VERSION,
      exportedAt: "x",
      folders: [
        { id: "parent", name: "Work", parentId: null },
        { id: "child", name: "Projects", parentId: "parent" },
      ],
      notes: [{ id: "n1", title: "Deep", markdown: "", folderId: "child", favorite: false, updatedAt: 1 }],
    };

    await applyBackup(backup);

    expect(createFolder).toHaveBeenNthCalledWith(1, "Work", null);
    expect(createFolder).toHaveBeenNthCalledWith(2, "Projects", "local:Work:root");
    expect(setNoteFolder).toHaveBeenCalledWith("n1", "local:Projects:local:Work:root");
  });

  it("leaves a note unfiled when its folderBackupId doesn't resolve to any created/reused folder", async () => {
    listFolders.mockReturnValue([]);
    listNotes.mockReturnValue([]);
    saveNote.mockResolvedValue(undefined);

    const backup: NoteBackup = {
      schema: BACKUP_SCHEMA,
      version: BACKUP_VERSION,
      exportedAt: "x",
      folders: [],
      notes: [{ id: "n1", title: "Orphan note", markdown: "", folderId: "missing-folder", favorite: false, updatedAt: 1 }],
    };

    await applyBackup(backup);

    expect(setNoteFolder).not.toHaveBeenCalled();
  });
});

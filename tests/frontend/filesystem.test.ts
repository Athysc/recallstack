import assert from "node:assert/strict";
import test from "node:test";
import { dirExists, fileExistsInDir, getDirHandle, uniqueFilenameInDir } from "../../src/services/filesystem.ts";
import { assertPortableName, portableNameError } from "../../src/services/portable-names.ts";
import {
  discoverWorkspaces,
  readWorkspaceNavigationPreferences,
  selectInitialWorkspace,
} from "../../src/features/workspaces/catalog.ts";

function directory(name: string, children: Record<string, any> = {}) {
  return {
    kind: "directory",
    name,
    async getDirectoryHandle(childName: string) {
      const child = children[childName];
      if (!child || child.kind !== "directory") throw new DOMException("missing", "NotFoundError");
      return child;
    },
    async getFileHandle(childName: string) {
      const child = children[childName];
      if (!child || child.kind !== "file") throw new DOMException("missing", "NotFoundError");
      return child;
    },
    async *values() {
      yield* Object.values(children);
    },
  } as unknown as FileSystemDirectoryHandle;
}

test("directory traversal and workspace discovery preserve expected prefixes", async () => {
  const alpha = directory("alpha");
  const beta = directory("beta");
  const data = directory("Data", { beta, alpha });
  const openbrain = directory("openbrain");
  const root = directory("root", { Data: data, openbrain });

  assert.equal(await getDirHandle(root, ["Data", "alpha"]), alpha);
  const discovered = await discoverWorkspaces(root);
  assert.equal(discovered.dataHandle, data);
  assert.deepEqual(discovered.workspaces.map(({ name, dbPrefix }) => ({ name, dbPrefix })), [
    { name: "alpha", dbPrefix: "Data/alpha/" },
    { name: "beta", dbPrefix: "Data/beta/" },
    { name: "openbrain", dbPrefix: "openbrain/" },
  ]);
});

test("unique filenames use the shared duplicate-name policy", async () => {
  const file = (name: string) => ({ kind: "file", name });
  const dir = directory("notes", { "Note.md": file("Note.md"), "Note (2).md": file("Note (2).md") });
  assert.equal(await uniqueFilenameInDir(dir, "Note.md"), "Note (3).md");
  assert.equal(await uniqueFilenameInDir(dir, "note.md"), "note (3).md");
  assert.equal(await fileExistsInDir(dir, "NOTE.MD"), true);
});

test("folder collisions are detected case-insensitively on Windows and Linux", async () => {
  const dir = directory("notes", { Projects: directory("Projects") });
  assert.equal(await dirExists(dir, "projects"), true);
  assert.equal(await dirExists(dir, "archive"), false);
});

test("portable names apply the same Windows-compatible policy on every platform", () => {
  for (const name of ["Project notes", "Résumé.md", "notes (2).md", ".recallstack"]) {
    assert.equal(portableNameError(name), null);
    assert.doesNotThrow(() => assertPortableName(name));
  }
  for (const name of ["", ".", "..", "CON", "con.md", "LPT9.txt", "bad:name.md", "bad?.md", "trailing.", "trailing ", "line\nbreak.md"]) {
    assert.ok(portableNameError(name), `expected ${JSON.stringify(name)} to be rejected`);
    assert.throws(() => assertPortableName(name), TypeError);
  }
});

test("workspace selection and navigation preferences have stable fallbacks", () => {
  const personal = { name: "personal", handle: directory("personal"), dbPrefix: "Data/personal/" };
  const system = { name: "openbrain", handle: directory("openbrain"), dbPrefix: "openbrain/" };
  assert.equal(selectInitialWorkspace([system, personal], "openbrain", false, new Set(["openbrain"])), personal);
  assert.equal(selectInitialWorkspace([system, personal], "personal", true, new Set(["openbrain"])), personal);

  const values = new Map([["pkm-nav1-mode-personal", "combo"]]);
  const preferences = readWorkspaceNavigationPreferences({ getItem: key => values.get(key) || null }, "personal");
  assert.deepEqual(preferences, { row1Mode: "combo", row2Mode: "buttons" });
});

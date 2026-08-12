import assert from "node:assert/strict";
import test from "node:test";
import { newMarkdownFileTitle, newMarkdownStoredFilename, normalizeMarkdownFilename } from "../../src/features/notes/new-file.ts";
import { fileExt, formatMtime, inboxFileGroup, sortFiles } from "../../src/features/notes/file-list.ts";

test("file list helpers group extensions and sort without mutating input", () => {
  const files = [
    { name: "z.md", mtime: 10 },
    { name: "a.md", mtime: 20 },
  ];
  assert.deepEqual(sortFiles(files, "alpha").map(file => file.name), ["a.md", "z.md"]);
  assert.deepEqual(sortFiles(files, "mtime").map(file => file.name), ["a.md", "z.md"]);
  assert.deepEqual(files.map(file => file.name), ["z.md", "a.md"]);
  assert.equal(fileExt("PHOTO.JPEG"), "jpeg");
  assert.equal(inboxFileGroup("PHOTO.JPEG").key, "image");
  assert.equal(inboxFileGroup("archive.bin").key, "other");
});

test("file timestamps retain the established list format", () => {
  assert.equal(formatMtime(new Date(2026, 7, 10, 9, 5).getTime()), "Aug 10, 2026 09:05");
});

test("new Markdown file prompts preserve explicit extensions and label each creation flow", () => {
  assert.equal(normalizeMarkdownFilename("  Release notes  "), "Release notes.md");
  assert.equal(normalizeMarkdownFilename("Release notes.MD"), "Release notes.md");
  assert.equal(normalizeMarkdownFilename("   "), "");
  assert.equal(newMarkdownFileTitle("note"), "New Note");
  assert.equal(newMarkdownFileTitle("task"), "New Task");
  assert.equal(newMarkdownFileTitle("working-task"), "New Working Task");
  assert.equal(newMarkdownStoredFilename("Release notes", "note"), "Release notes.md");
  assert.equal(
    newMarkdownStoredFilename("Release task.md", "task"),
    "Release task -- s00000000_c00000000_due00000000_normal.md",
  );
  assert.equal(
    newMarkdownStoredFilename("Working task", "working-task"),
    "Working task -- s00000000_c00000000_due00000000_normal.md",
  );
});

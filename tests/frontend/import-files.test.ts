import assert from "node:assert/strict";
import test from "node:test";
import {
  allFilesAreMarkdown,
  buildImportedFilePath,
  isMarkdownFilename,
  mergeSelectedFiles,
  openImportActionEnabled,
  partitionMarkdownFilenames,
  removeSelectedFile,
  resolveImportDestination,
} from "../../src/features/editor/import-files.ts";

test("only .md filenames are accepted, case-insensitively", () => {
  assert.equal(isMarkdownFilename("notes.md"), true);
  assert.equal(isMarkdownFilename("notes.MD"), true);
  assert.equal(isMarkdownFilename("notes.txt"), false);
  const { accepted, rejected } = partitionMarkdownFilenames(["a.md", "b.txt", "c.MD", "d"]);
  assert.deepEqual(accepted, ["a.md", "c.MD"]);
  assert.deepEqual(rejected, ["b.txt", "d"]);
});

test("header drop shortcut requires every dropped file to be Markdown, not just some", () => {
  assert.equal(allFilesAreMarkdown(["a.md", "b.MD"]), true);
  assert.equal(allFilesAreMarkdown(["a.md", "b.txt"]), false);
  assert.equal(allFilesAreMarkdown(["photo.png"]), false);
  assert.equal(allFilesAreMarkdown([]), true);
});

test("Browse and drag-and-drop selections merge into one deduplicated list", () => {
  const existing = [{ key: "/a.md", name: "a.md" }];
  const incoming = [{ key: "/a.md", name: "a.md" }, { key: "/b.md", name: "b.md" }];
  const merged = mergeSelectedFiles(existing, incoming);
  assert.deepEqual(merged.map(f => f.key), ["/a.md", "/b.md"]);
  // Order is preserved: first-selected file stays first (it becomes the
  // active tab when "Open/Import" opens multiple files).
  assert.equal(merged[0].key, "/a.md");
  const afterRemoval = removeSelectedFile(merged, "/a.md");
  assert.deepEqual(afterRemoval.map(f => f.key), ["/b.md"]);
});

test("import destination requires both a top-level folder and a real subfolder", () => {
  assert.equal(resolveImportDestination(null, "notes"), null);
  assert.equal(resolveImportDestination("Data", null), null);
  assert.equal(resolveImportDestination("Data", "__root__"), null);
  assert.deepEqual(resolveImportDestination("Data", "notes"), ["Data", "notes"]);
  assert.equal(buildImportedFilePath(["Data", "notes"], "file.md"), "Data/notes/file.md");
});

test("primary action is gated on selection count and, for import mode, a chosen destination", () => {
  assert.equal(openImportActionEnabled(0, "temporary", null), false);
  assert.equal(openImportActionEnabled(1, "temporary", null), true);
  assert.equal(openImportActionEnabled(1, "import", null), false);
  assert.equal(openImportActionEnabled(1, "import", ["Data", "notes"]), true);
});

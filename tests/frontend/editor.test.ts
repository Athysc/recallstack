import assert from "node:assert/strict";
import test from "node:test";
import { clampEditorSelection, useMarkdownExtensions } from "../../src/features/editor/markdown-editor.ts";

test("selection restoration clamps stale offsets after external edits", () => {
  assert.deepEqual(clampEditorSelection(4, 20, 8), [4, 8]);
  assert.deepEqual(clampEditorSelection(-3, 2, 8), [0, 2]);
});

test("large documents use the degradation threshold", () => {
  assert.equal(useMarkdownExtensions(999_999), true);
  assert.equal(useMarkdownExtensions(1_000_001), false);
  assert.equal(useMarkdownExtensions(11, 10), false);
});

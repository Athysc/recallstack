import assert from "node:assert/strict";
import test from "node:test";
import { clampEditorSelection, useMarkdownExtensions } from "../../src/features/editor/markdown-editor.ts";
import { PreviewScheduler } from "../../src/features/editor/preview-scheduler.ts";

test("selection restoration clamps stale offsets after external edits", () => {
  assert.deepEqual(clampEditorSelection(4, 20, 8), [4, 8]);
  assert.deepEqual(clampEditorSelection(-3, 2, 8), [0, 2]);
});

test("large documents use the degradation threshold", () => {
  assert.equal(useMarkdownExtensions(999_999), true);
  assert.equal(useMarkdownExtensions(1_000_001), false);
  assert.equal(useMarkdownExtensions(11, 10), false);
});

test("preview scheduling defers hidden work and keeps only the latest render", async () => {
  const scheduler = new PreviewScheduler({ normalDelayMs: 1, largeDelayMs: 2 });
  const renders: string[] = [];
  scheduler.schedule(10, false, () => renders.push("hidden"));
  await new Promise(resolve => setTimeout(resolve, 4));
  assert.deepEqual(renders, []);
  scheduler.flush();
  assert.deepEqual(renders, ["hidden"]);

  scheduler.schedule(10, true, () => renders.push("old"));
  scheduler.schedule(10, true, () => renders.push("latest"));
  await new Promise(resolve => setTimeout(resolve, 4));
  assert.deepEqual(renders, ["hidden", "latest"]);
});

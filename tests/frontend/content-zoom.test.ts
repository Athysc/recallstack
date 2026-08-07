import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONTENT_ZOOM_STEPS,
  contentZoomScale,
  normalizeContentZoom,
  scaledMediaWidth,
} from "../../src/features/editor/content-zoom.ts";

test("content zoom exposes default through double-size increments", () => {
  assert.deepEqual([...CONTENT_ZOOM_STEPS], [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(contentZoomScale(0), 1);
  assert.equal(contentZoomScale(50), 1.5);
  assert.equal(contentZoomScale(100), 2);
});

test("invalid persisted zoom values reset to the default", () => {
  assert.equal(normalizeContentZoom("30"), 30);
  assert.equal(normalizeContentZoom("35"), 0);
  assert.equal(normalizeContentZoom("not-a-number"), 0);
  assert.equal(normalizeContentZoom(null), 0);
});

test("preview zoom retains the full live pane width", async () => {
  const css = await readFile(new URL("../../src/ui/styles/editor.css", import.meta.url), "utf8");
  assert.match(css, /\.preview-zoom-surface\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.preview-zoom-surface\s*\{[^}]*font-size:\s*var\(--content-preview-font-size\)/s);
  assert.doesNotMatch(css, /\.preview-zoom-surface\s*\{[^}]*zoom:/s);
});

test("preview media enlarges without exceeding the live pane width", () => {
  assert.equal(scaledMediaWidth(300, 800, 2), 600);
  assert.equal(scaledMediaWidth(600, 800, 2), 800);
  assert.equal(scaledMediaWidth(300, 400, 1.5), 400);
  assert.equal(scaledMediaWidth(0, 800, 2), 0);
});

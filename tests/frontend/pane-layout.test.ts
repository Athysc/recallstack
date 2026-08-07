import assert from "node:assert/strict";
import test from "node:test";

import { clampDivider, resizePanePair } from "../../src/features/tasks/pane-layout.ts";

test("three-pane pair resizing preserves total width and 20-percent minimums", () => {
  assert.deepEqual(resizePanePair(300, 300, -200, 180), { first: 180, second: 420 });
  assert.deepEqual(resizePanePair(300, 300, 250, 180), { first: 420, second: 180 });
  assert.deepEqual(resizePanePair(300, 300, 50, 180), { first: 350, second: 250 });
});

test("editor-preview divider respects both minimum widths", () => {
  assert.equal(clampDivider(100, 300, 900, 180, 5), 480);
  assert.equal(clampDivider(850, 300, 900, 180, 5), 715);
  assert.equal(clampDivider(600, 300, 900, 180, 5), 600);
});

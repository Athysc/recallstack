import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaskFilename,
  normalizeTaskPriority,
  parseTaskFilename,
  taskDisplayTitle,
} from "../../src/features/tasks/filenames.ts";

test("task filenames round-trip all supported metadata", () => {
  const filename = buildTaskFilename("Ship release.md", {
    startDate: "2026-08-06",
    completedDate: null,
    dueDate: "2026-08-12",
    priority: "High Priority",
  });

  assert.equal(filename, "Ship release -- s20260806_c00000000_due20260812_highpriority.md");
  assert.deepEqual(parseTaskFilename(filename), {
    title: "Ship release",
    startDate: "2026-08-06",
    completedDate: null,
    dueDate: "2026-08-12",
    priority: "highpriority",
  });
});

test("task filename helpers retain legacy fallbacks", () => {
  assert.equal(normalizeTaskPriority(undefined), "normal");
  assert.equal(taskDisplayTitle("Ordinary note.md"), "Ordinary note");
  assert.equal(parseTaskFilename("Ordinary note.md"), null);
  assert.match(buildTaskFilename("", {}), /^Untitled -- /);
});

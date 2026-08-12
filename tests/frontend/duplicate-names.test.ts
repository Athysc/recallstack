import assert from "node:assert/strict";
import test from "node:test";

import { nextDuplicateFilename, parseTaskFilename, taskDisplayTitle } from "../../src/features/tasks/filenames.ts";

test("regular duplicates use incrementing parenthesized numbers", async () => {
  const existing = new Set(["Note.md", "Note (2).md", "Note (3).md"]);
  assert.equal(await nextDuplicateFilename("Note.md", name => existing.has(name)), "Note (4).md");
  assert.equal(await nextDuplicateFilename("Note (2).md", name => existing.has(name)), "Note (4).md");
});

test("task duplicates keep metadata valid but hide it from the displayed title", async () => {
  const original = "Ship release -- s20260801_c00000000_due20260815_high.md";
  const copy = await nextDuplicateFilename(original, () => false);
  assert.equal(taskDisplayTitle(copy), "Ship release (2)");
  assert.deepEqual(parseTaskFilename(copy), {
    title: "Ship release (2)",
    startDate: "2026-08-01",
    completedDate: null,
    dueDate: "2026-08-15",
    priority: "high",
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { isJournalPath, journalLocationForDate, journalTitleFromPath, latestJournalPathBefore } from "../../src/features/tasks/paths.ts";

test("daily journal paths are identified in the workspace-level dailylogs folder", () => {
  const path = "dailylogs/2026/08/journal-20260806.md";
  assert.equal(isJournalPath(path), true);
  assert.equal(journalTitleFromPath(path), "journal-20260806");
});

test("selected calendar dates map to their workspace-level daily journal file", () => {
  assert.deepEqual(journalLocationForDate(["personal", "tasks"], "2026-08-06"), {
    filename: "journal-20260806.md",
    targetParts: ["dailylogs", "2026", "08"],
    path: "dailylogs/2026/08/journal-20260806.md",
  });
  assert.equal(journalLocationForDate(["personal", "tasks"], "not-a-date"), null);
  assert.equal(latestJournalPathBefore([
    "dailylogs/2026/07/journal-20260731.md",
    "dailylogs/2026/08/journal-20260805.md",
    "dailylogs/2026/08/journal-20260809.md",
  ], ["personal", "tasks"], "2026-08-06"), "dailylogs/2026/08/journal-20260805.md");
});

test("ordinary tasks and similarly named folders are not journal notes", () => {
  assert.equal(isJournalPath("tasks/working/note.md"), false);
  assert.equal(isJournalPath("personal/notes/journal/note.md"), false);
  assert.equal(journalTitleFromPath("tasks/note.md"), null);
});

import assert from "node:assert/strict";
import test from "node:test";

import { isGlobalTasksPath, isJournalPath, journalLocationForDate, journalTitleFromPath, latestJournalPathBefore } from "../../src/features/tasks/paths.ts";

test("isGlobalTasksPath matches the global tasks and dailylogs roots only", () => {
  assert.equal(isGlobalTasksPath("tasks/foo.md"), true);
  assert.equal(isGlobalTasksPath("tasks/working/bar.md"), true);
  assert.equal(isGlobalTasksPath("dailylogs/2026/09/journal-20260901.md"), true);
  assert.equal(isGlobalTasksPath("personal/notes/x.md"), false);
  assert.equal(isGlobalTasksPath("personal/tasks/x.md"), false);
  assert.equal(isGlobalTasksPath(""), false);
  assert.equal(isGlobalTasksPath(null), false);
});

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

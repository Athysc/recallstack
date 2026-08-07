import assert from "node:assert/strict";
import test from "node:test";

import { isJournalPath, journalTitleFromPath } from "../../src/features/tasks/paths.ts";

test("daily journal paths are identified at any workspace depth", () => {
  const path = "personal/tasks/journal/2026/08/journal-20260806.md";
  assert.equal(isJournalPath(path), true);
  assert.equal(journalTitleFromPath(path), "journal-20260806");
});

test("ordinary tasks and similarly named folders are not journal notes", () => {
  assert.equal(isJournalPath("personal/tasks/working/note.md"), false);
  assert.equal(isJournalPath("personal/notes/journal/note.md"), false);
  assert.equal(journalTitleFromPath("personal/tasks/note.md"), null);
});

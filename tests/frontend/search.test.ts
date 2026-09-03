import assert from "node:assert/strict";
import test from "node:test";
import { highlightMatch, mapNativeIndex, mapNativeSearchResults, removeSearchEntry, searchLocalIndex, stripWorkspacePrefix, upsertSearchEntry } from "../../src/features/search/search.ts";

test("search index updates immutably and ranks filename matches first", () => {
  const initial = [{ notesRelPath: "notes/a.md", name: "a.md", content: "needle in body" }];
  const added = upsertSearchEntry(initial, "notes/needle.md", "body");
  assert.equal(initial.length, 1);
  assert.deepEqual(searchLocalIndex(added, "needle").map(result => result.name), ["needle.md", "a.md"]);
  assert.deepEqual(removeSearchEntry(added, "notes/a.md").map(entry => entry.name), ["needle.md"]);
});

test("native search mapping strips literal prefixes and preserves the raw filename", () => {
  assert.equal(stripWorkspacePrefix("personal.v1/notes/a.md", "personal.v1"), "notes/a.md");
  assert.equal(mapNativeIndex([{ path: "personal.v1/notes/a.md", name: "a.md" }], "personal.v1")[0].notesRelPath, "notes/a.md");
  const [result] = mapNativeSearchResults([{
    path: "personal/tasks/Ship.md", name: "Ship.md", kind: "task", snippet: "ship it", tags: ["release"],
  }], "personal", "ship");
  assert.equal(result.notesRelPath, "tasks/Ship.md");
  assert.equal(result.name, "Ship.md");
  assert.equal(result.matchInName, true);
  assert.equal(highlightMatch("A <needle>", "needle", value => value.replaceAll("<", "&lt;").replaceAll(">", "&gt;")), "A &lt;<mark>needle</mark>&gt;");
});

test("an empty prefix leaves global tasks/dailylogs keys untouched", () => {
  assert.equal(stripWorkspacePrefix("tasks/Ship.md", ""), "tasks/Ship.md");
  assert.equal(mapNativeIndex([{ path: "dailylogs/2026/09/journal-20260901.md", name: "journal-20260901.md" }], "")[0].notesRelPath, "dailylogs/2026/09/journal-20260901.md");
});

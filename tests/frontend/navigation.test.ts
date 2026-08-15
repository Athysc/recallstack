import assert from "node:assert/strict";
import test from "node:test";
import {
  createCurrentViewStore,
  listReloadMode,
  parseLastFolderView,
  serializeLastFolderView,
} from "../../src/features/navigation/view-state.ts";

test("current view store publishes meaningful navigation transitions", () => {
  const store = createCurrentViewStore({ workspace: "personal", view: "list" });
  const transitions: string[] = [];
  const unsubscribe = store.subscribe((next, previous) => transitions.push(`${previous.view}->${next.view}`));

  store.update({ view: "list" });
  store.update({ view: "editor", level1: "project", level2: "notes", path: "project/notes/Test.md" });
  unsubscribe();
  store.update({ view: "search" });

  assert.deepEqual(transitions, ["list->editor"]);
  assert.equal(store.get().path, "project/notes/Test.md");
});

test("list-reload dispatch has a branch for every active mode, including Outputs", () => {
  const base = { allTasksMode: false, outputsMode: false, outputsActiveFolder: null, l1Active: null, l2Active: null };

  // Regression case for the actual bug: Outputs mode active with a selected
  // folder must dispatch to "outputs", not silently fall through to "none"
  // the way reloadActiveList() used to before it had an outputsMode branch.
  assert.equal(listReloadMode({ ...base, outputsMode: true, outputsActiveFolder: { name: "reports" } }), "outputs");
  // Outputs mode active but no folder selected yet (e.g. an empty Outputs
  // root) has nothing to reload.
  assert.equal(listReloadMode({ ...base, outputsMode: true }), "none");

  assert.equal(listReloadMode({ ...base, allTasksMode: true }), "all-tasks");
  assert.equal(listReloadMode({ ...base, l1Active: { name: "project" } }), "folder");
  assert.equal(listReloadMode({ ...base, l2Active: { name: "notes" } }), "folder");
  assert.equal(listReloadMode(base), "none");

  // allTasksMode takes priority over a stale outputsMode/l1Active, matching
  // reloadActiveList()'s original if/else-if ordering.
  assert.equal(listReloadMode({ ...base, allTasksMode: true, outputsMode: true, outputsActiveFolder: { name: "x" }, l1Active: { name: "y" } }), "all-tasks");
});

test("last folder views round-trip and reject malformed persisted state", () => {
  const view = { l1: "project", l2: "notes", mode: "file" as const, path: "project/notes/Test.md" };
  assert.deepEqual(parseLastFolderView(serializeLastFolderView(view)), view);
  assert.equal(parseLastFolderView('{"mode":"file"}'), null);
  assert.equal(parseLastFolderView('{"l1":"project","mode":"file","path":null}'), null);
  assert.equal(parseLastFolderView("not json"), null);
});

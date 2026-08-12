import assert from "node:assert/strict";
import test from "node:test";
import {
  createCurrentViewStore,
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

test("last folder views round-trip and reject malformed persisted state", () => {
  const view = { l1: "project", l2: "notes", mode: "file" as const, path: "project/notes/Test.md" };
  assert.deepEqual(parseLastFolderView(serializeLastFolderView(view)), view);
  assert.equal(parseLastFolderView('{"mode":"file"}'), null);
  assert.equal(parseLastFolderView('{"l1":"project","mode":"file","path":null}'), null);
  assert.equal(parseLastFolderView("not json"), null);
});

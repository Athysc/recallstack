import assert from "node:assert/strict";
import test from "node:test";
import {
  activeTab,
  findTabByPath,
  relativeTab,
  rememberClosedTab,
  remapTabPaths,
  reorderTabs,
  syncTabFromDocument,
  type EditorTab,
} from "../../src/features/editor/tabs.ts";

function tab(id: number, path: string, outputs = false, external = false): EditorTab {
  return {
    id, path, title: path, isNew: false, dirty: false, isOutputsFile: outputs,
    outputsFileHandle: null, outputsDirHandle: null, returnToOutputs: false, returnToAllTasks: false,
    isExternalFile: external, externalPath: external ? path : null, externalFileHandle: null, pinned: false,
  };
}

test("tab lookup, reorder, relative selection, and path remapping share one ordered model", () => {
  const tabs = [tab(1, "old/a.md"), tab(2, "old/b.md"), tab(3, "openbrain/outputs/c.md", true)];
  assert.equal(findTabByPath(tabs, "old/b.md")?.id, 2);
  assert.equal(activeTab(tabs, 1)?.path, "old/a.md");
  assert.equal(reorderTabs(tabs, 1, 2, true), true);
  assert.deepEqual(tabs.map(item => item.id), [2, 1, 3]);
  assert.equal(relativeTab(tabs, 1, 1)?.id, 3);
  remapTabPaths(tabs, "old/", "new/", path => path.split("/").at(-1)!);
  assert.deepEqual(tabs.map(item => item.path), ["new/b.md", "new/a.md", "openbrain/outputs/c.md"]);
});

test("document snapshots update dirty state and closed-history bounds", () => {
  const item = tab(1, "a.md");
  assert.equal(syncTabFromDocument(item, {
    path: "a.md", content: "changed", savedContent: "saved", isNew: false, isOutputsFile: false,
    outputsFileHandle: null, outputsDirHandle: null, returnToOutputs: false, returnToAllTasks: false,
  }, path => path || "Untitled"), true);
  assert.equal(item.dirty, true);
  const history: Array<{ path: string; title: string }> = [];
  rememberClosedTab(history, item, 1);
  rememberClosedTab(history, tab(2, "b.md"), 1);
  assert.deepEqual(history.map(entry => entry.path), ["b.md"]);
});

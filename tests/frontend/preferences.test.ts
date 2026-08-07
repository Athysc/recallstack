import assert from "node:assert/strict";
import test from "node:test";

import { PREFERENCE_KEYS, draftPreferenceKey, workspacePreferenceKey } from "../../src/app/preferences.ts";

test("workspace-scoped keys remain backward compatible", () => {
  assert.equal(workspacePreferenceKey("theme", "Personal"), "pkm-theme-Personal");
  assert.equal(workspacePreferenceKey("last-view", "Work"), "pkm-last-view-Work");
});

test("draft keys distinguish workspaces and new notes", () => {
  assert.equal(draftPreferenceKey("Personal", "notes/a.md"), "pkm-draft:Personal:notes/a.md");
  assert.equal(draftPreferenceKey(null, null), "pkm-draft:__no_workspace__:__new__");
});

test("working pane layout and dimensions have stable persisted keys", () => {
  assert.equal(PREFERENCE_KEYS.workingPaneVisible, "pkm-working-pane-visible");
  assert.equal(PREFERENCE_KEYS.workingPaneLayout, "pkm-working-pane-layout");
  assert.equal(PREFERENCE_KEYS.workingPaneBottomRatio, "pkm-working-pane-bottom-ratio");
  assert.equal(PREFERENCE_KEYS.workingPaneWidths, "pkm-working-pane-widths");
});

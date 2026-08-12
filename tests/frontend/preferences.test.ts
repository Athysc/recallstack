import assert from "node:assert/strict";
import test from "node:test";

import { PREFERENCE_KEYS, draftPreferenceKey, preferenceIsEnabled, workspacePreferenceKey } from "../../src/app/preferences.ts";

test("workspace-scoped keys remain backward compatible", () => {
  assert.equal(workspacePreferenceKey("theme", "Personal"), "pkm-theme-Personal");
  assert.equal(workspacePreferenceKey("last-view", "Work"), "pkm-last-view-Work");
});

test("draft keys distinguish workspaces and new notes", () => {
  assert.equal(draftPreferenceKey("Personal", "notes/a.md"), "pkm-draft:Personal:notes/a.md");
  assert.equal(draftPreferenceKey(null, null), "pkm-draft:__no_workspace__:__new__");
});

test("boolean preferences can default on while preserving an explicit off choice", () => {
  assert.equal(preferenceIsEnabled(null, true), true);
  assert.equal(preferenceIsEnabled("on", true), true);
  assert.equal(preferenceIsEnabled("off", true), false);
  assert.equal(preferenceIsEnabled(null), false);
});

test("working pane layout and dimensions have stable persisted keys", () => {
  assert.equal(PREFERENCE_KEYS.workingPaneVisible, "pkm-working-pane-visible");
  assert.equal(PREFERENCE_KEYS.workingPaneLayout, "pkm-working-pane-layout");
  assert.equal(PREFERENCE_KEYS.workingPaneBottomRatio, "pkm-working-pane-bottom-ratio");
  assert.equal(PREFERENCE_KEYS.workingPaneWidths, "pkm-working-pane-widths");
});

test("editor and preview zoom has a stable global preference key", () => {
  assert.equal(PREFERENCE_KEYS.contentZoom, "pkm-content-zoom");
});

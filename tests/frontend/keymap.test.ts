import assert from "node:assert/strict";
import test from "node:test";

import {
  KEY_BINDINGS,
  KEYMAP_BY_ID,
  KEYMAP_CATEGORY_ORDER,
  bindingsByCategory,
  comboFor,
  duplicateCombos,
} from "../../src/features/commands/keymap.ts";

test("every binding is fully described", () => {
  for (const binding of KEY_BINDINGS) {
    assert.ok(binding.id && /^[a-z][a-z0-9.-]*$/.test(binding.id), binding.id);
    assert.ok(binding.combo.trim().length > 0, binding.id);
    assert.ok(binding.label.trim().length > 0, binding.id);
    assert.ok(binding.description.trim().length > 0, binding.id);
    assert.ok(KEYMAP_CATEGORY_ORDER.includes(binding.category), binding.category);
  }
});

test("binding ids are unique and indexed", () => {
  const ids = KEY_BINDINGS.map(binding => binding.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(KEYMAP_BY_ID.size, ids.length);
});

test("no two bindings claim the same key combo", () => {
  assert.deepEqual(duplicateCombos(), []);
});

test("the remapped shortcuts resolve to their new combos", () => {
  assert.equal(comboFor("command.palette"), "Ctrl+P");
  assert.equal(comboFor("global.keybindings"), "Ctrl+K");
  assert.equal(comboFor("view.theme"), "Ctrl+L");
  assert.equal(comboFor("navigation.today"), "Ctrl+J");
  assert.equal(comboFor("tasks.list"), "Ctrl+T");
  assert.equal(comboFor("tasks.working-list"), "Ctrl+W");
  assert.equal(comboFor("tools.import"), "Ctrl+I");
  assert.ok(comboFor("tabs.close")?.includes("Ctrl+Q"));
  assert.equal(comboFor("does.not.exist"), undefined);
});

test("cheat-sheet grouping keeps every binding and preserves category order", () => {
  const groups = bindingsByCategory();
  const flattened = groups.flatMap(group => group.bindings);
  assert.equal(flattened.length, KEY_BINDINGS.length);
  const order = groups.map(group => group.category);
  assert.deepEqual(order, [...order].sort((a, b) => KEYMAP_CATEGORY_ORDER.indexOf(a) - KEYMAP_CATEGORY_ORDER.indexOf(b)));
});

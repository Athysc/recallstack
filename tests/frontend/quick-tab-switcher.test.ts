import assert from "node:assert/strict";
import test from "node:test";

import { codeQuickTabs, tabJumpCodes } from "../../src/ui/components/quick-tab-switcher.ts";

function assertPrefixFree(codes: string[]): void {
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) {
    assert.equal(codes.some(other => other !== code && other.startsWith(code)), false, `${code} is a prefix`);
  }
}

test("ordinary tab counts receive immediate single-letter jump codes", () => {
  assert.deepEqual(tabJumpCodes(4), ["A", "S", "D", "F"]);
  assertPrefixFree(tabJumpCodes(23));
});

test("larger tab lists receive prefix-free single and double letter codes", () => {
  const codes = tabJumpCodes(80);
  assert.equal(codes.length, 80);
  assert.ok(codes.some(code => code.length === 1));
  assert.ok(codes.some(code => code.length === 2));
  assert.equal(codes.some(code => /[JKX]/.test(code)), false);
  assertPrefixFree(codes);
});

test("reserved navigation and close keys never appear at code-generation boundaries", () => {
  for (const count of [1, 23, 24, 80, 177, 178, 529]) {
    const codes = tabJumpCodes(count);
    assert.equal(codes.length, count);
    assert.equal(codes.some(code => /[JKX]/.test(code)), false, `reserved key used for ${count} tabs`);
    assertPrefixFree(codes);
  }
});

test("coded tab records retain tab identity and metadata", () => {
  assert.deepEqual(codeQuickTabs([{
    id: 7,
    title: "Daily note",
    path: "personal/notes/Daily note.md",
    kind: "Note",
    dirty: true,
  }]), [{
    id: 7,
    title: "Daily note",
    path: "personal/notes/Daily note.md",
    kind: "Note",
    dirty: true,
    code: "A",
  }]);
});

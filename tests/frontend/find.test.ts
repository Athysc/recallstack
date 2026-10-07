import assert from "node:assert/strict";
import test from "node:test";

import { findMatches, indexFromPosition, isValidPattern, stepIndex } from "../../src/features/editor/find.ts";

test("finds all matches case-insensitively", () => {
  assert.deepEqual(findMatches("Foo foo FOO", "foo"), [
    { from: 0, to: 3 }, { from: 4, to: 7 }, { from: 8, to: 11 },
  ]);
});

test("empty term and no hits give no matches", () => {
  assert.deepEqual(findMatches("abc", ""), []);
  assert.deepEqual(findMatches("abc", "z"), []);
});

test("terms are regular expressions", () => {
  assert.deepEqual(findMatches("a1 b22 c", "\\d+"), [{ from: 1, to: 2 }, { from: 4, to: 6 }]);
});

test("invalid regex falls back to a literal search", () => {
  assert.equal(isValidPattern("(a"), false);
  assert.deepEqual(findMatches("x (a y", "(a"), [{ from: 2, to: 4 }]);
  assert.deepEqual(findMatches("a+b a+b", "a+b+("), []);
});

test("zero-length matches are skipped and the match list is capped", () => {
  assert.deepEqual(findMatches("abc", "x*"), []);
  assert.equal(findMatches("a".repeat(100), "a", 10).length, 10);
});

test("stepIndex wraps in both directions", () => {
  assert.equal(stepIndex(0, 3, 1), 1);
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(-1, 3, 1), 0);
  assert.equal(stepIndex(-1, 3, -1), 2);
  assert.equal(stepIndex(0, 0, 1), -1);
});

test("indexFromPosition picks the nearest match with wrap-around", () => {
  const m = [{ from: 2, to: 3 }, { from: 10, to: 11 }, { from: 20, to: 21 }];
  assert.equal(indexFromPosition(m, 0, 1), 0);
  assert.equal(indexFromPosition(m, 10, 1), 1);
  assert.equal(indexFromPosition(m, 25, 1), 0);
  assert.equal(indexFromPosition(m, 10, -1), 0);
  assert.equal(indexFromPosition(m, 1, -1), 2);
  assert.equal(indexFromPosition([], 5, 1), -1);
});

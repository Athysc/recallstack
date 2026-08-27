import assert from "node:assert/strict";
import test from "node:test";

import { assignRowCodes, type ListingSection } from "../../src/ui/components/listing-modal.ts";

function section(title: string | null, ids: number[]): ListingSection {
  return { title, rows: ids.map(id => ({ id, title: `row-${id}` })) };
}

test("jump codes run as one flat sequence across sections, skipping headers", () => {
  const coded = assignRowCodes([
    section("Tasks", [1, 2]),
    section("Completed", [3]),
    section(null, [4, 5, 6]),
  ]);
  assert.deepEqual(coded.map(row => row.id), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(coded.map(row => row.code), ["A", "S", "D", "F", "G", "H"]);
});

test("codes stay prefix-free for larger listings", () => {
  const rows = Array.from({ length: 40 }, (_, i) => i + 1);
  const coded = assignRowCodes([section(null, rows)]);
  assert.equal(coded.length, 40);
  const codes = coded.map(row => row.code);
  assert.equal(new Set(codes).size, 40);
  for (const code of codes) {
    assert.equal(codes.some(other => other !== code && other.startsWith(code)), false, `${code} is a prefix`);
  }
});

test("row metadata is carried through onto the coded rows", () => {
  const [row] = assignRowCodes([{ title: null, rows: [{ id: 9, title: "Note", priorityClass: "priority-high", actionLabel: "Archive", actionKind: "archive" }] }]);
  assert.equal(row.id, 9);
  assert.equal(row.priorityClass, "priority-high");
  assert.equal(row.actionLabel, "Archive");
  assert.equal(row.actionKind, "archive");
  assert.equal(row.code, "A");
});

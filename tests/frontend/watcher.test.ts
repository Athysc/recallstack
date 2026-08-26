import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidationScopes,
  normalizeWorkspaceBatch,
  WatcherSequenceGuard,
  WorkspaceBatchAccumulator,
  type WorkspaceChangeBatch,
} from "../../src/services/watcher.ts";

function batch(sequence: number, changes: WorkspaceChangeBatch["changes"] = []): WorkspaceChangeBatch {
  return { workspaceId: "ws-test", sequence, occurredAt: 1, overflowed: false, changes };
}

test("watcher guard detects gaps and rejects stale batches", () => {
  const guard = new WatcherSequenceGuard();
  assert.deepEqual(guard.inspect(batch(4)), { gap: false, stale: false });
  assert.deepEqual(guard.inspect(batch(6)), { gap: true, stale: false });
  assert.deepEqual(guard.inspect(batch(5)), { gap: false, stale: true });
});

test("watcher batches normalize paths and route workspace-level task invalidations", () => {
  const normalized = normalizeWorkspaceBatch({
    workspaceId: "ws-test",
    sequence: 1,
    occurredAt: 2,
    overflowed: false,
    changes: [{ kind: "rename", path: "Data\\notes\\tasks\\new.md", previousPath: "Data\\notes\\tasks\\old.md", entity: "markdown", internal: false }],
  });
  assert.ok(normalized);
  assert.equal(normalized.changes[0].path, "Data/notes/tasks/new.md");
  assert.deepEqual([...invalidationScopes(normalized)].sort(), ["calendar", "notes", "search", "tasks"]);
});

test("watcher batches route workspace-level dailylogs to calendar invalidations", () => {
  const value = batch(1, [{ kind: "modify", path: "Data/notes/dailylogs/2026/08/journal-20260812.md", entity: "markdown", internal: false }]);
  assert.deepEqual([...invalidationScopes(value)].sort(), ["calendar", "notes", "search"]);
});

test("overflow invalidates every derived frontend scope", () => {
  const value = batch(1);
  value.overflowed = true;
  assert.equal(invalidationScopes(value).size, 7);
});

test("background batch accumulator collapses event bursts into one workspace delivery", () => {
  const accumulator = new WorkspaceBatchAccumulator();
  accumulator.add(batch(1, [
    { kind: "modify", path: "Data/notes/a.md", entity: "markdown", internal: true },
    { kind: "create", path: "Data/notes/transient.md", entity: "markdown", internal: false },
  ]));
  accumulator.add(batch(2, [
    { kind: "modify", path: "Data/notes/a.md", entity: "markdown", internal: false },
    { kind: "remove", path: "Data/notes/transient.md", entity: "markdown", internal: false },
    { kind: "create", path: "Data/notes/b.md", entity: "markdown", internal: false },
  ]), true);

  const combined = accumulator.takeAll();
  assert.equal(combined.length, 1);
  assert.equal(combined[0].sequence, 2);
  assert.equal(combined[0].sequenceGap, true);
  assert.deepEqual(combined[0].changes.map(change => change.path), ["Data/notes/a.md", "Data/notes/b.md"]);
  assert.equal(combined[0].changes[0].internal, false, "an external event must not be hidden by an internal one");
  assert.equal(accumulator.size, 0);
});

test("background batch accumulator retains overflow recovery state", () => {
  const accumulator = new WorkspaceBatchAccumulator();
  const overflow = batch(8, [{ kind: "modify", path: "Data/notes/a.md", entity: "markdown", internal: false }]);
  overflow.overflowed = true;
  accumulator.add(overflow);
  accumulator.add(batch(9, [{ kind: "modify", path: "Data/notes/b.md", entity: "markdown", internal: false }]));

  const [combined] = accumulator.takeAll();
  assert.equal(combined.overflowed, true);
  assert.equal(combined.changes.length, 2);
});

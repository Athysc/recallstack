import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidationScopes,
  normalizeWorkspaceBatch,
  WatcherSequenceGuard,
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

test("watcher batches normalize paths and route task invalidations", () => {
  const normalized = normalizeWorkspaceBatch({
    workspaceId: "ws-test",
    sequence: 1,
    occurredAt: 2,
    overflowed: false,
    changes: [{ kind: "rename", path: "Data\\notes\\home\\tasks\\new.md", previousPath: "Data\\notes\\home\\tasks\\old.md", entity: "markdown", internal: false }],
  });
  assert.ok(normalized);
  assert.equal(normalized.changes[0].path, "Data/notes/home/tasks/new.md");
  assert.deepEqual([...invalidationScopes(normalized)].sort(), ["calendar", "notes", "search", "tasks"]);
});

test("overflow invalidates every derived frontend scope", () => {
  const value = batch(1);
  value.overflowed = true;
  assert.equal(invalidationScopes(value).size, 7);
});

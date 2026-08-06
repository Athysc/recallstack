# Improvement 5 Implementation Plan: Filesystem Watching

**Status:** In progress — regression-critical event filtering and targeted refresh implemented 2026-08-06  
**Recommended execution point:** After the performance milestone and typed native data services  
**Primary outcome:** Detect external workspace changes and refresh only affected application state without losing unsaved edits or repeatedly rescanning the workspace.

## Implementation Progress

Completed early as part of the native data-layer performance milestone:

- Native events are normalized to workspace-relative paths and coalesced in 200 ms batches.
- Non-mutating read, open, and other access events are discarded before batching.
- Index reads can no longer trigger watcher/indexer feedback loops.
- Only create, remove, rename, content modification, and relevant write-time events are emitted.
- Changed Markdown paths are reindexed individually.
- The frontend refreshes only an affected visible folder or All Tasks scope.
- Existing list contents remain visible while replacement data loads.
- Shared request generations prevent stale list responses from repainting newer navigation.
- `Apps/themes.json` changes reload the external theme catalog separately from note lists.

Still required for the complete improvement:

- Stable workspace IDs and sequence-gap/overflow recovery.
- Rename pairing with `previousPath` in the frontend contract.
- Internal-write journaling and exact echo suppression.
- Selective navigation, calendar, backlink, and asset invalidation.
- Full clean/dirty editor conflict UI and watcher-health reporting.
- Cross-platform watcher integration and burst tests.

## Original Baseline

The Rust backend creates a `notify::RecommendedWatcher` and emits `workspace://changed`, but the running original frontend does not subscribe to that event. Events contain absolute path strings, are not debounced, and are not classified. This is backend scaffolding, not a completed watcher feature.

## Required Behavior

- Detect create, modify, rename, and remove operations below all active workspace roots.
- Support changes caused by editors, scripts, sync tools, and Git operations.
- Update navigation, file lists, task aggregates, search index, backlinks, and asset state selectively.
- Never overwrite an unsaved editor buffer automatically.
- Avoid event storms during Git checkout, branch switch, sync, or bulk imports.
- Ignore RecallStack’s own database, backup, trash, temporary, and internal writes where appropriate.

## Event Contract

Replace raw path arrays with a typed event:

```ts
interface WorkspaceChangeBatch {
  workspaceId: string;
  sequence: number;
  occurredAt: number;
  overflowed: boolean;
  changes: Array<{
    kind: "create" | "modify" | "remove" | "rename";
    path: string;
    previousPath?: string;
    entity: "markdown" | "asset" | "directory" | "other";
  }>;
}
```

All paths exposed to the frontend must be normalized, workspace-relative paths.

## Implementation Phases

### Phase 1: Watcher ownership and lifecycle

1. Create a watcher manager keyed by stable workspace ID.
2. Start watchers only after workspace validation succeeds.
3. Stop the previous watcher during workspace switch or application shutdown.
4. Watch `Data/` and supported system workspace roots; do not assume every relevant file is under `Data/`.
5. Handle watcher initialization failure as a recoverable feature error.

### Phase 2: Normalize and batch events

1. Convert platform-specific `notify` events to the common contract.
2. Pair rename events when the platform provides source/destination information.
3. Debounce for approximately 150–300 ms.
4. Coalesce repeated changes to the same path.
5. Collapse child events when a containing directory is removed.
6. Mark the batch `overflowed` when native watcher overflow means a targeted update is unsafe.

### Phase 3: Separate internal and external writes

1. Add an internal-write journal containing path, operation, and short expiry.
2. Native write/move/trash commands register expected events.
3. Watcher batches label or suppress exact internal echoes.
4. Never suppress a later independent external modification.

### Phase 4: Frontend invalidation

Create a `watcher.ts` service that subscribes once and routes changes:

- Markdown create/remove/rename updates current lists and navigation counts.
- Markdown modification updates cached metadata and schedules reindexing.
- Asset changes invalidate preview/object URLs.
- Directory changes refresh only the affected navigation level.
- Task changes refresh task groups and relevant calendar dates.
- An overflow triggers one background workspace reconciliation.

### Phase 5: Unsaved-edit conflict handling

When the open file changes externally:

- If the editor is clean, reload it and preserve cursor/scroll where possible.
- If the editor is dirty, retain the user buffer and show a persistent conflict banner.
- Offer **Compare**, **Reload from disk**, and **Keep my version**.
- Save must not silently overwrite a newer disk version; use the version token/mtime from the read command.

### Phase 6: Reconciliation and recovery

1. Add a lightweight reconciliation command comparing indexed metadata with disk metadata.
2. Run it after overflow, resume from sleep, watcher restart, or detected sequence gaps.
3. Reindex only changed files.
4. Expose watcher health in the workspace health report.

## Testing Strategy

- Unit tests for event normalization, coalescing, exclusions, and rename pairing.
- Integration tests creating/modifying/renaming/removing files in a temporary workspace.
- Burst tests with hundreds of events.
- Conflict tests with dirty and clean editor buffers.
- Git checkout/pull simulation on a temporary repository.
- Windows and Linux watcher tests because semantics differ.

## Completion Criteria

- External edits appear without manual refresh.
- A single changed note does not trigger a full workspace scan.
- Bulk operations settle into a bounded number of UI refreshes.
- Unsaved content is never silently discarded.
- Rename and delete events keep native search and task aggregates consistent.
- Watcher restart and overflow recovery are observable and tested.

## Risks and Controls

- **Event storms:** batching, coalescing, and targeted invalidation.
- **Platform differences:** normalize in Rust and test both target operating systems.
- **Write feedback loops:** short-lived internal-write journal.
- **Data loss:** conflict detection using file version tokens.

## Out of Scope

- Cloud synchronization.
- Collaborative editing.
- Automatic Git commits.

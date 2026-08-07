# Improvement 7 Implementation Plan: Backup and Safety

**Status:** Implemented and verified (2026-08-06)
**Recommended execution point:** After native data services and filesystem watching  
**Primary outcome:** Ensure destructive and conflicting operations are recoverable, observable, and resistant to partial failure.

## Implemented Scope

- Native, path-validated mutation bridge with typed results, an application-data audit log, atomic writes, version-token conflict checks, and crash-recovery drafts.
- Recoverable workspace trash for files, assets, and nested directories, with restore, restore-as collision handling, inspection, and explicitly confirmed permanent emptying.
- Application-data note versions retained for 90 days and capped at 250 MiB per workspace.
- Streaming ZIP backups with a SHA-256 manifest, cache/trash exclusions, cancellation, progress events, atomic finalization, and immediate or on-demand verification.
- Workspace health, broken-link/orphan-asset reporting, search-index rebuild, and read-only Git status in the Safety & Workspace Tools interface.
- Rust tests cover atomic replacement, nested copy, version retention, backup verification, cancellation cleanup, and damaged archives; the frontend parity/type/build suite also passes.

## Current Baseline

The Rust backend contains ZIP backup and workspace-health commands, and a separate note-to-trash command exists. The original running interface does not use these consistently. Several original actions still call `removeEntry`, including permanent asset and folder deletion. There is no undo log, version history, crash recovery, Git status integration, or transactional multi-file operation framework.

## Safety Principles

- Markdown and assets remain canonical files.
- Destructive actions are recoverable by default.
- Multi-step operations either complete or leave a recovery record.
- The application never silently overwrites externally changed content.
- Database indexes are disposable caches and excluded from canonical backups when appropriate.
- Safety features must work without Git, while integrating with Git when available.

## Implementation Phases

### Phase 1: Centralize filesystem mutations

1. Route create, write, rename, move, archive, restore, and delete through Rust commands.
2. Remove direct destructive compatibility calls from frontend feature code.
3. Add typed mutation results containing affected paths, version tokens, and recovery information.
4. Validate paths and destination conflicts in Rust.
5. Write mutation audit records to application data, not the user’s Markdown tree unless explicitly configured.

### Phase 2: Workspace trash and restore

1. Define `.recallstack-trash/` metadata and retention policy.
2. Preserve original relative path, deletion time, entity type, and collision information.
3. Move notes, assets, and directories to trash instead of deleting by default.
4. Add Trash view, Restore, Restore As, and Empty Trash actions.
5. Empty Trash requires explicit confirmation and reports irrecoverable scope.
6. Support platform recycle-bin integration later, but do not make recoverability depend on it.

### Phase 3: Safe writes and crash recovery

1. Write note content to a sibling temporary file.
2. Flush and atomically replace where supported.
3. Retain a bounded recovery copy if replacement fails.
4. Persist unsaved editor drafts in application data using workspace ID and relative path.
5. On startup, offer recovery only when the draft is newer/different than disk.
6. Clear drafts after a verified successful save.

Windows replacement semantics require a platform-tested implementation rather than assuming Unix `rename` behavior.

### Phase 4: Version history

1. Create lightweight versions before destructive overwrite, rename collision resolution, bulk metadata edits, or conversion operations.
2. Store compressed deltas or full copies under application data, keyed by stable workspace identity.
3. Configure retention by age and total size.
4. Add per-note history list, preview, compare, and restore-as-new-version.
5. Never place opaque history blobs inside the canonical Markdown tree by default.

### Phase 5: Workspace backup

1. Replace the current memory-heavy ZIP implementation with streaming I/O.
2. Allow destination selection outside the workspace; avoid recursive backup-of-backups.
3. Include a manifest containing version, workspace identity, creation time, file count, checksums, and exclusions.
4. Default to canonical content and settings; make index/cache inclusion optional.
5. Write to a temporary destination and rename only after successful completion.
6. Add backup verification and a restore dry run.
7. Surface progress, cancellation, final path, and errors in the UI.

### Phase 6: Health and repair tools

Implement Tools commands:

- Validate Workspace.
- Rebuild Search Index.
- Find Broken Links.
- Find Orphan Assets.
- Verify Backup.
- Inspect Trash.
- Check Git Status.

Health reports must distinguish errors, warnings, and informational findings and support export to Markdown/JSON.

### Phase 7: Optional Git integration

1. Detect whether the workspace is inside a Git repository.
2. Show read-only status and changed files first.
3. Add optional commit support only after explicit user configuration.
4. Never auto-push.
5. Treat Git as an additional recovery layer, not a prerequisite.

## Data Contracts

Each mutation should return a structure similar to:

```ts
interface MutationResult {
  operationId: string;
  changed: string[];
  recovery?: { kind: "trash" | "version" | "draft"; id: string };
  warnings: string[];
}
```

File reads and writes must use version tokens so external changes can be detected before overwrite.

## Testing Strategy

- Unit tests for path validation, collision naming, retention, and manifests.
- Failure injection during write, move, ZIP creation, and restore.
- Restore tests for files, nested directories, and assets.
- Cross-platform atomic-write tests.
- Draft recovery after forced process termination.
- Backup checksum and corrupted-archive tests.
- Verify no operation traverses symlinks outside the workspace unexpectedly.

## Completion Criteria

- Default delete actions for notes, folders, and assets are recoverable.
- Interrupted saves do not destroy the last valid file.
- Unsaved drafts can be recovered after a crash.
- Backups are streamed, checksummed, cancelable, and verifiable.
- Workspace health tools are accessible from the interface.
- External modification conflicts require an explicit user decision.
- Every destructive operation produces a clear result and recovery path.

## Risks and Controls

- **Trash growth:** configurable retention and size reporting.
- **History privacy:** application-data storage and documented location.
- **Partial multi-file moves:** operation journal plus restart recovery.
- **Backup recursion:** hard exclusions for backup and internal cache directories.
- **Git complexity:** read-only integration first.

## Out of Scope

- Cloud backup services.
- Automatic Git push.
- Real-time collaborative version history.

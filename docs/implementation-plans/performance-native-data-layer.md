# Performance Milestone Implementation Plan: Native Data Layer

**Status:** In progress — first native data-path slice implemented 2026-08-06  
**Priority:** Execute before improvements 4–10  
**Primary outcome:** Preserve the original RecallStack layout while replacing slow, fine-grained browser-handle emulation with a measured, bulk, native Rust data layer.

## Implementation Progress

Completed in the first slice:

- Removed the synchronous workspace note-count walk.
- Added metadata/version tokens to native listings and a native stat command.
- Skipped file-body reads used only for modification-time sorting.
- Added background, metadata-aware SQLite/FTS reconciliation in one transaction.
- Disabled sql.js/WASM and the recursive JavaScript search-index build on desktop.
- Connected desktop search and All Tasks to bounded native SQLite queries.
- Added UTF-8 text IPC and per-path version-checked note saves.
- Coalesced watcher events for 200 ms, discarded non-mutating access events, reindexed only affected Markdown paths, and targeted visible-list refreshes.
- Deferred Mermaid loading until a rendered note contains a diagram.
- Added IPC/performance instrumentation and a private-data-free 1,000-note benchmark.

Still required for milestone completion:

- File-backed/custom-protocol binary previews instead of number-array IPC.
- Request generations/cancellation for rapid navigation and search.
- Typed TypeScript service modules as the monolith is split in improvement 4.
- Watcher overflow recovery, rename pairing, and expected-write echo labeling.
- End-to-end release measurements and stable Windows/Linux regression gates.

## Problem Statement

The desktop port currently preserves the original UI through `desktop-shim.js`, which emulates the browser File System Access API. That adapter turns small browser operations into many Tauri IPC calls:

- Each directory lookup calls native existence checks.
- Each directory enumeration crosses IPC.
- `getFile()` transfers the complete file even when callers only need metadata.
- Binary writes become JavaScript number arrays.
- Workspace activation walks all notes to compute a count.
- Workspace switching recursively reads every Markdown file into a JavaScript search index.
- The original frontend also loads sql.js/WASM and an entire SQLite file, while native SQLite code remains disconnected.

The result is high startup latency, UI blocking, excess allocation, and poor scaling on the real nested workspace.

## Milestone Boundaries

This milestone does not redesign the interface. It changes the data path beneath the established UI and introduces only the minimum TypeScript service layer needed to call it safely.

The seven workstreams are:

1. Bulk native directory and workspace snapshots.
2. Metadata access without reading contents.
3. Native SQLite/FTS with no blocking JavaScript scan.
4. Lazy folder/note/task loading.
5. Efficient text and binary IPC.
6. Debounced targeted watcher updates.
7. Performance benchmarks and regression gates.

## Success Metrics

Record baselines before implementation on the real workspace and a checked-in synthetic fixture. Final numeric budgets should be adjusted after baseline measurement, but the initial targets are:

- Application shell visible within 500 ms after WebView creation.
- Previously opened workspace navigation usable within 1 second on a warm index.
- Folder listing response below 100 ms for ordinary folders.
- Opening a normal Markdown note below 100 ms excluding expensive preview diagrams.
- Search results begin within 100 ms on a warm FTS index.
- Typing and navigation produce no main-thread tasks longer than 50 ms under ordinary use.
- One external file change causes no full workspace scan.
- Idle memory does not contain a second full copy of every Markdown file.

## Target Architecture

```text
Original RecallStack DOM/CSS
          │
Typed TypeScript data services
          │ bounded Tauri commands/events
          ▼
Rust WorkspaceService
  ├── filesystem metadata + safe mutations
  ├── SQLite/FTS index
  ├── task/link parsing
  ├── watcher + reconciliation
  └── streaming/binary responses
          │
          ▼
Markdown/assets (canonical) + DB/index.db (rebuildable cache)
```

`desktop-shim.js` may remain temporarily for unmigrated feature operations, but performance-critical reads must move to explicit services. Every remaining shim method must be inventoried and assigned a removal milestone.

## Workstream 0: Baseline and Instrumentation

Complete this before optimization so improvements are measurable.

1. Add frontend performance marks for bootstrap, workspace activation, navigation rendered, search ready, folder rendered, and note rendered.
2. Add Rust tracing spans for commands, filesystem walks, database transactions, parsing, and watcher batches.
3. Add a development-only performance panel or structured log export.
4. Record IPC command counts and transferred byte estimates per workflow.
5. Create a synthetic workspace generator or fixture representing nested notes, tasks, assets, and outputs without copying private note contents.
6. Benchmark these workflows:
   - Cold launch to welcome.
   - Reopen last workspace.
   - Switch workspace.
   - Open folders with 10, 100, and 1,000 entries.
   - Open/save a note.
   - Load All Tasks and Working Tasks.
   - Search.
   - Git-style burst of file changes.

Deliverable: `docs/performance-baseline.md` plus machine-readable benchmark output.

## Workstream 1: Bulk Native Directory and Workspace Snapshots

### Goal

Replace chains of `getDirectoryHandle`/`values`/`getFile` emulation with bounded native queries returning everything required for the current screen.

### Commands

Introduce typed commands such as:

```ts
workspace_open(path): WorkspaceOpenResult
workspace_navigation(workspaceId): NavigationSnapshot
folder_list(workspaceId, relativePath, options): FolderSnapshot
task_summary(workspaceId, scope, filters): TaskSnapshot
outputs_list(workspaceId, relativePath): OutputSnapshot
```

`WorkspaceOpenResult` returns identity, available logical workspaces, capabilities, last-active location, index state, and no recursively calculated note count. Counts that require walking/indexing are optional background data.

`FolderSnapshot` returns directory children and file metadata in one call. It must be paged or bounded for very large directories.

### Rust Changes

1. Create a `WorkspaceService` owned by Tauri state rather than growing `commands/workspace.rs` indefinitely.
2. Define stable workspace IDs derived from canonical root identity rather than exposing absolute paths everywhere.
3. Normalize relative paths once in Rust.
4. Validate symlink behavior and prevent traversal outside allowed roots.
5. Cache immutable or versioned directory snapshots only when profiling supports it.
6. Remove `count_notes()` from synchronous workspace activation.

### Frontend Changes

1. Add typed `workspaceService` and `folderService` modules.
2. Adapt existing navigation rendering to snapshot data without changing DOM structure/classes.
3. Use one request per visible navigation/folder state.
4. Cancel or ignore stale responses when the user switches locations quickly.

### Acceptance

- Opening a workspace performs no full `Data/` walk for display counts.
- Rendering a folder requires one bounded metadata request, not one request per item.
- Rapid folder switching cannot render an older response over the newer location.

## Workstream 2: Metadata Without Content Reads

### Goal

Never read file bodies to obtain names, types, sizes, or modification times.

### Data Contract

```ts
interface FileMetadata {
  path: string;
  name: string;
  kind: "markdown" | "asset" | "other";
  size: number;
  modifiedNs: string;
  version: string;
}
```

Use a string for nanosecond/integer values that may exceed JavaScript’s safe integer range. A version token should incorporate stable metadata and optionally a content hash when already available.

### Implementation

1. Add native stat and batched listing APIs.
2. Change file lists and sorting to consume returned metadata directly.
3. Update task list APIs to return parsed metadata with results.
4. Audit every `getFile()` caller in `recallstack.html` and classify it as metadata-only, text read, binary read, or preview URL.
5. Remove metadata-only `getFile()` calls first.
6. Keep content reads explicit and observable.

### Acceptance

- Sorting a folder by modification time transfers zero file bodies.
- Rendering assets shows metadata without reading each asset.
- Performance logs distinguish metadata and content operations.

## Workstream 3: Native SQLite/FTS and Background Indexing

### Goal

Make Rust SQLite the sole desktop index, remove sql.js/WASM from desktop startup, and stop loading all Markdown contents into JavaScript.

### Schema and Migrations

Use the schema direction in `10-knowledge-search.md`, initially implementing only what the current UI needs:

- Workspace and file metadata.
- Note title/body/tags.
- Task metadata.
- FTS5 search table.
- Index schema/version and reconciliation state.

1. Create numbered migrations.
2. Treat existing tables conservatively; use namespaced tables or a controlled migration.
3. Ensure the index remains rebuildable.
4. Use WAL only after confirming compatibility with any external index tooling.

### Index Lifecycle

1. On workspace open, validate schema and return current index readiness immediately.
2. If current, do not scan contents.
3. If stale/missing, start background reconciliation.
4. Compare metadata/version tokens before reading contents.
5. Parse and write changed files in batches and transactions.
6. Emit progress and completion events.
7. Support cancellation on workspace switch or shutdown.

### Frontend Migration

1. In desktop mode, do not load `sql-wasm.js` or `sql-wasm.wasm`.
2. Replace `buildSearchIndex()` with native search readiness and query calls.
3. Replace All Tasks full-content scans with native task queries.
4. Keep a temporary browser-only path only if browser delivery is explicitly supported.

### Acceptance

- No sql.js/WASM files are loaded by the desktop runtime.
- Workspace switching does not recursively transfer all Markdown files to JavaScript.
- Search and aggregate task views are backed by native queries.
- Deleting `DB/index.db` triggers a background rebuild without data loss.

## Workstream 4: Lazy Loading and UI Scheduling

### Goal

Load only the data required for the visible view and keep expensive rendering away from immediate navigation and typing.

### Implementation

1. Render the application shell and cached navigation before optional counts.
2. Load the active folder only; do not pre-read every note.
3. Page or virtualize lists only above measured thresholds.
4. Query task aggregates from SQLite by active scope instead of scanning task directories.
5. Fetch note content only when the note opens.
6. Debounce Markdown preview rendering; render Mermaid after ordinary Markdown is visible.
7. Lazy-load Mermaid and full syntax-highlighting bundles on first use.
8. Cancel obsolete folder, search, task, and preview work.
9. Move nonessential health, counts, and reconciliation status to background updates.

### State Rules

- Each asynchronous request includes workspace ID and navigation generation.
- UI ignores results for inactive generations.
- Loading indicators distinguish initial, incremental, and background work.
- Errors in optional background work do not block note editing.

### Acceptance

- Opening a folder does not read contents of unopened notes.
- All Tasks uses a bounded native query.
- Mermaid-heavy notes do not delay editor availability.
- Rapid navigation remains responsive and stale results do not flash.

## Workstream 5: Efficient Text and Binary IPC

### Goal

Avoid JSON arrays and unnecessary copies for file contents.

### Text APIs

Use explicit UTF-8 text commands:

```ts
note_read(workspaceId, path): { text, metadata, version }
note_write(workspaceId, path, text, expectedVersion): WriteResult
```

Rust returns strings directly. Writes validate version tokens and use the safe-write framework planned in improvement 7.

### Binary APIs

1. Use Tauri’s raw IPC response capability or asset/custom-protocol streaming for binary reads.
2. Never call `Array.from(Uint8Array)` for large data.
3. Prefer file-backed preview URLs/custom protocol for images, audio, video, and PDFs.
4. Stream backup archives directly to disk; never buffer entire archives in frontend memory.
5. Define size limits and progress/cancellation for large clipboard/drop assets.

### Acceptance

- Note reads/writes cross IPC as UTF-8 strings with bounded copies.
- Large asset previews do not become JavaScript number arrays.
- Memory profiling shows no avoidable duplicate full-file buffers.
- Saving detects stale expected versions.

## Workstream 6: Debounced Targeted Watcher Updates

### Goal

Use native watcher events to invalidate precise data and index rows without full rescans.

### Implementation

1. Normalize events to relative paths and entity types in Rust.
2. Batch/debounce events for approximately 150–300 ms.
3. Coalesce repeat events and pair renames where possible.
4. Reindex only changed Markdown files.
5. Refresh only affected folder/navigation/task queries.
6. Invalidate affected asset preview URLs.
7. Detect dirty-editor conflicts using version tokens.
8. On watcher overflow, schedule one background reconciliation rather than synchronous UI work.
9. Suppress or label expected echoes from RecallStack’s own writes.

The full conflict UI and watcher health work continue in `05-filesystem-watching.md`; this milestone implements the performant event pipeline needed by them.

### Acceptance

- One external note edit causes one targeted index/update batch.
- Bulk Git changes are coalesced and do not freeze the UI.
- An open dirty note is never silently replaced.
- Watcher overflow recovers in the background.

## Workstream 7: Benchmarks and Regression Gates

### Goal

Prevent performance from regressing as improvements 4–10 are implemented.

### Benchmark Suite

Create Rust and end-to-end benchmarks for:

- Workspace validation/open response.
- Navigation snapshot.
- Folder listing by size.
- Note text read/write.
- FTS query and result serialization.
- Task aggregate query.
- Incremental one-file indexing.
- Full rebuild throughput.
- Watcher burst coalescing.
- Binary preview path.

### Gates

1. Store baselines by fixture size and platform.
2. Fail CI on correctness regressions.
3. Initially report performance changes without failing while variance is characterized.
4. Add percentage/budget gates for stable benchmarks.
5. Track IPC count and bytes as first-class metrics.
6. Require a performance note for changes to indexing, directory listing, rendering, or IPC contracts.

### Manual Profiling Checklist

- Browser main-thread flame chart.
- Rust tracing output.
- Memory before and after workspace open.
- Search latency after warm-up.
- Folder-switch behavior under repeated clicks.
- External Git/sync burst.
- Windows portable and Arch Linux comparison.

### Acceptance

- Baseline and post-milestone reports exist.
- Critical workflow budgets are automated where stable.
- IPC command count and transfer volume fall substantially from baseline.
- The real workspace meets agreed responsiveness targets.

## Recommended Execution Order

1. Baseline/instrumentation.
2. Remove synchronous note count from workspace open.
3. Bulk navigation/folder snapshots and metadata-only listings.
4. Explicit text and binary transfer APIs.
5. Native SQLite migrations and background indexer.
6. Migrate search and task aggregates; disable desktop sql.js and JavaScript search scan.
7. Lazy UI scheduling and cancellation.
8. Targeted watcher updates.
9. Benchmark, profile, tune, and set regression gates.
10. Remove performance-critical compatibility-shim paths.

## File-Level Change Map

Expected new or revised areas:

```text
src/
  services/native.ts
  services/workspace.ts
  services/filesystem.ts
  services/search.ts
  services/tasks.ts
  services/watcher.ts
  app/performance.ts
src-tauri/src/
  services/workspace.rs
  services/index.rs
  services/filesystem.rs
  services/watcher.rs
  commands/workspace.rs
  commands/search.rs
  commands/tasks.rs
  migrations/
tests/fixtures/workspace/
docs/performance-baseline.md
```

During the milestone, minimize edits to layout CSS and visual markup. The original UI is the regression reference.

## Verification Matrix

| Workflow | Correctness check | Performance check |
|---|---|---|
| Open workspace | Workspaces/navigation match disk | No full content scan; usable within budget |
| List folder | Names, sorts, mtimes correct | One bounded metadata request |
| Open note | Exact UTF-8 content and metadata | Normal note opens within budget |
| Save note | Version-safe persisted content | No number-array binary conversion |
| Search | Correct ranked matches | Warm query within budget |
| All Tasks | Status/date/priority parity | Native bounded query, no directory scan |
| External edit | UI/index update correctly | Targeted batch, no full reconciliation |
| Large asset | Correct preview | Stream/file-backed path, bounded memory |

## Milestone Completion Criteria

- The original layout and primary workflows remain intact.
- Workspace open and switch do not recursively transfer all Markdown contents.
- Directory/file metadata never requires reading file bodies.
- Search and task aggregates use native SQLite.
- Desktop no longer loads sql.js or builds `searchIndex` in JavaScript.
- Notes use explicit versioned text read/write commands.
- Assets use an efficient binary or file-backed path.
- Watcher changes are debounced and targeted.
- Benchmarks demonstrate improvement and guard critical paths.
- Performance-critical use of `desktop-shim.js` is removed; remaining compatibility operations are documented.

## Rollback Strategy

- Land workstreams in small commits with contract versioning.
- Keep the existing path behind a development-only fallback until each migrated workflow passes parity tests.
- Never maintain dual write paths in production; select exactly one writer per operation.
- SQLite schema migrations must support rebuild-from-Markdown fallback.
- If a new native read/query path fails, show an actionable error rather than silently falling back to a full synchronous scan.

## Risks and Controls

- **UI parity regressions:** do not redesign markup during this milestone.
- **Index mismatch:** Markdown remains canonical; reconciliation and rebuild are mandatory.
- **Platform path differences:** normalize and test Windows/Linux paths in Rust.
- **Async race conditions:** workspace IDs, generation tokens, cancellation, and stale-response rejection.
- **Premature caching:** measure first; prefer bounded native queries over complex frontend caches.
- **Private benchmark data:** use synthetic fixtures for committed tests and keep real-workspace measurements local.

## Explicit Non-Goals

- Frontend modularization beyond the service boundary required for performance.
- Command palette or CodeMirror integration.
- Advanced backlinks/saved searches beyond the native schema foundation.
- New packaging formats.
- Visual redesign.

# RecallStack Native Data-Layer Performance Baseline

**Recorded:** 2026-08-06  
**Milestone:** `performance-native-data-layer.md`  
**Status:** First implementation slice; synthetic native-index measurements are automated, end-to-end UI measurements remain to be captured on Windows and Linux release builds.

## Baseline Diagnosis

Before this milestone, desktop workspace activation and common navigation paths performed work proportional to the whole workspace:

- Workspace activation synchronously walked `Data/` to calculate a note count.
- Workspace switching recursively read every Markdown body into a JavaScript search array.
- Folder sorting called `getFile()` for every Markdown file merely to obtain modification times.
- All Tasks recursively read task files through many filesystem-handle IPC calls.
- Desktop startup loaded sql.js/WASM even though Rust already had SQLite support.
- Text and binary data crossed IPC as JavaScript number arrays.
- Filesystem watcher events were forwarded individually and did not update the native index.
- Mermaid's approximately 3.5 MB script was parsed during startup even when no diagram was visible.

Those paths made startup, workspace switching, and aggregate views scale poorly and kept a second copy of note content in the WebView.

## Implemented Measurement Hooks

The desktop compatibility layer now records per-command call counts, cumulative command duration, estimated transferred bytes, and workspace-open performance marks. In a desktop development console, capture the current session with:

```js
window.__recallstackNative.performanceSnapshot()
```

The result contains `elapsedMs`, `transferredBytes`, `calls`, and browser performance `measures`. This is deliberately local-only and does not transmit note contents or telemetry.

## Synthetic Native-Index Benchmark

The Rust test suite creates a temporary, private-data-free workspace with 1,000 Markdown notes across 20 folders. Each note contains a heading, tag, and repeated synthetic body. It measures a cold reconciliation followed by an unchanged warm reconciliation.

Run it with:

```sh
cargo test --manifest-path src-tauri/Cargo.toml benchmark_native_index_cold_and_warm -- --nocapture
```

| Environment | Notes | Cold reconciliation | Warm reconciliation | Warm files reread |
|---|---:|---:|---:|---:|
| Linux debug build, Ryzen 9 9900X, NVMe/local temp directory | 1,000 | 172 ms | 3 ms | 0 |

The cold number is a debug-build observation, not a cross-platform release target. The important regression property is that an unchanged warm pass reads zero Markdown bodies. Machine-readable results are in `performance-baseline.json`.

## Current Budget Status

| Workflow | Initial target | Current evidence |
|---|---:|---|
| Workspace command returns | <1,000 ms warm | Full note count removed; indexing starts in background |
| Unchanged index reconciliation | No content rereads | Pass: 0 of 1,000 bodies reread, 3 ms observed |
| Folder sort | Zero body transfers | Pass on desktop Markdown listings |
| Search | <100 ms warm | Native FTS path implemented; end-to-end timing pending |
| All Tasks | Bounded native query | One native SQLite query and one result batch implemented |
| Note read/write | No number-array text transfer | Direct UTF-8 IPC with per-path version tokens implemented |
| External changes | No full rescan | 200 ms coalesced batches and path-targeted reindex implemented |
| Large binary preview | Bounded memory | Pending custom-protocol/file-backed asset path |
| Shell visible | <500 ms after WebView | Mermaid and sql.js deferred/disabled on desktop; release measurement pending |

## Regression Checks

The native tests currently verify that:

1. A cold reconciliation indexes all synthetic notes.
2. An unchanged reconciliation indexes no files.
3. Editing one Markdown file updates exactly one row.
4. Removing a Markdown file deletes its stale database row.

UI timing should be measured in release builds on both the Windows portable executable and Arch Linux. Capture at minimum: reopen workspace, 10/100/1,000-entry folders, normal note open/save, All Tasks, warm search, and a burst of external changes. Do not use private note contents in checked-in results.

## Known Remaining Performance Work

- Replace binary `Vec<u8>`/number-array previews with file-backed or custom-protocol URLs.
- Add navigation-generation cancellation so stale folder/search responses cannot render.
- Add stable end-to-end benchmark automation and release-build gates.
- Split remaining performance-critical shim calls into typed TypeScript services during frontend modularization.
- Add watcher overflow reconciliation and expected-write echo labeling.

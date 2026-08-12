# Future Enhancements

Last assessed: 2026-08-11 for RecallStack 0.1.2.

The current release candidate is in good performance shape. The optimized Linux timing fixture opens the shell in 18 ms, restores its synthetic 1,003-note workspace in 31 ms, renames a folder containing 1,000 notes in under 1 ms, opens the first note in 28 ms, and opens recursive Outputs in 19 ms. Warm native-index reconciliation rereads zero unchanged Markdown files. The production startup JavaScript also remains below its enforced 320 KB minified budget.

The items below are later-build opportunities, not known release blockers.

## High priority

### Establish a reviewed Windows baseline and shared functional smoke matrix

The release workflow already runs the same optimized timing fixture on `windows-2022` and Linux, but the first reviewed Windows result has not yet been recorded in the checked-in baseline. Preserve that artifact, compare it with the Linux command counts and timings, and add a platform-neutral native smoke suite that runs on both operating systems. It should cover open/edit/save/reopen, case-insensitive filename collisions, folder create/rename, tasks, calendar, search, Outputs, asset byte ranges, trash/version recovery, and backup verification. Keep Linux-only pixel comparisons separate because WebView rendering differs across engines.

### Harden rendered-content isolation

Replace or supplement the custom Markdown HTML sanitizer with a maintained sanitizer such as DOMPurify, add sanitizer regression fixtures, and evaluate a restrictive Content Security Policy. Also review whether the globally exposed Tauri API and URL-opener capability can be narrowed to the minimum commands required by the app. Mermaid is now explicitly configured with `securityLevel: "strict"`, but rendered content should continue to be treated as untrusted workspace input.

### Bound and cancel backup verification

Backup creation can be cancelled, but verification and restore dry-run currently stream until every declared archive entry has been hashed. Add cancellation, total expanded-byte and compression-ratio policies, and visible progress so a malformed or extremely compressed archive cannot monopolize a worker indefinitely. Choose limits that still accommodate intentionally large media workspaces.

## Performance and scale

### Expand release measurements

Add first-search, All Tasks, calendar, save, backup, and large-media measurements to the current startup/navigation fixture. Capture peak RSS or working-set size while seeking through large audio, video, and PDF assets on Windows and Linux. Store medians from several runs rather than relying only on a single observation, and alert on relative regressions after stable platform baselines exist.

### Virtualize exceptionally large result views

Native indexing and bulk scans have removed the major IPC bottlenecks, but thousands of task cards, search results, or Output cards can still create a large DOM. Measure those views at 10,000+ entries and introduce windowed rendering only where profiling shows layout or memory pressure.

### Add progress and cancellation to long native mutations

Folder rename is atomic and effectively constant-time on one filesystem, while the native recursive copy fallback is much faster than per-entry frontend IPC. For cross-device trash moves, exceptionally large backup/restore work, and future bulk imports, add byte/file progress, cancellation, resumable cleanup, and explicit reporting for skipped symbolic links.

### Improve custom asset protocol semantics

The asset protocol streams byte ranges without transferring binary arrays through JavaScript. A later refinement can return HTTP 416 plus `Content-Range: bytes */<size>` for unsatisfiable ranges, add validators for unchanged local assets, and benchmark WebView cache behavior without weakening workspace containment.

## Portability and resilience

### Audit existing workspaces for non-portable names

New files and folders now follow a shared Windows-compatible character, reserved-name, trailing-character, and case-collision policy on both Windows and Linux. Imported or previously created Linux workspaces may still contain incompatible names or case-only duplicates. Extend Workspace Health to report them and offer a reviewed rename plan; do not rename existing user data automatically.

### Reduce filesystem race windows

Native paths reject traversal and symbolic-link components, including the primary note commands. A same-user process could still swap a path after validation and before use. Where supported, migrate sensitive mutations toward directory-handle/descriptor-relative operations that avoid check-then-use races.

### Strengthen release supply-chain reproducibility

Pin GitHub Actions to reviewed commit SHAs, periodically review bundled SQLite/Tauri dependency advisories, and add an automated dependency-update cadence. Keep lockfiles and the existing version/package verification gates mandatory.

### Clarify symlink behavior in recovery operations

RecallStack intentionally avoids following workspace symlinks. The cross-device trash fallback currently skips them. Surface that as a warning before the source is removed, or preserve safe link metadata where platform behavior is well-defined, so recovery semantics are explicit and identical across operating systems.

# Changelog

## 0.1.2 — 2026-08-11

### Added

- A return-to-tab icon in folder navigation restores the most recently selected tab.
- A `Ctrl+Space` open-tab selector supports arrows or Vim-style `J/K`, Enter, Escape with focus restoration, `X` to close and refresh tabs in place, and immediate one- or two-letter jump codes that exclude `J`, `K`, and `X`.
- Every selected calendar day now leads with a Journal / Daily Log button that opens or creates that date's journal entry.
- New note, task, and working-task commands open a keyboard-first filename modal with the generated default selected, Enter-to-create, and Escape-to-cancel behavior.
- Automated release-binary timing on native Windows and Linux runners, with JSON artifacts and startup regression budgets.
- Workspace-sandboxed asset streaming with byte ranges, adaptive Markdown preview scheduling, and production bundle performance gates.

### Changed

- Completed the strict typed-frontend cutover: the production application controller is now compiler-checked with the rest of `src/`, and regression coverage rejects TypeScript checking suppressions.
- CodeMirror now loads on the first real document instead of during application startup.
- Recursive Outputs and orphan-asset scans run as bounded native bulk operations.
- Top-level and nested folder renames now use one native atomic rename instead of recursively copying file bodies through JavaScript and deleting the source tree.
- Runtime UI responsibilities were split into typed editor scheduling, toast, and dependency-status modules.
- The selected tab title is now bold and uses a theme-derived accent that maintains readable contrast in light and dark themes.

### Fixed

- New-file prompts display only the editable title while appending `.md` during creation, and newly created tasks receive their complete default metadata suffix immediately.
- Clicking a file already open in a tab now returns to its editor instead of appearing to do nothing.
- Large asset previews no longer transfer binary data as JavaScript number arrays.
- New notes and folders use one Windows-compatible naming and case-collision policy on both Windows and Linux.
- Outputs paths can no longer break out of HTML attributes, native note commands reject symbolic-link escapes, and Mermaid security is explicitly strict.

## 0.1.1 — 2026-08-07

### Added

- A persistent, right-aligned footer picker enlarges only CodeMirror content and the complete rendered preview from 110% through 200% for screen sharing and high-resolution displays.
- Complete local Arch Linux dependency, verification, AppImage, tarball, and `PKGBUILD` instructions are now linked from the repository README.

### Changed

- Reviewed GitHub release jobs now use the Node 24–based `checkout`, `setup-node`, and `upload-artifact` actions.
- Preview zoom now follows the full live pane width, so paragraphs, code blocks, tables, images, and Mermaid diagrams reflow when the divider moves.

### Fixed

- Windows release checks now accept CRLF line endings in `Cargo.lock`, the reference HTML, modular CSS, and production markup.
- Windows Rust tests now close SQLite connections before deleting temporary index fixtures, avoiding file-in-use failures.
- The reviewed release workflow remains manual-only after initial GitHub registration, preventing automatic publication from pushes.

## 0.1.0 — 2026-08-06

### Added

- Tauri 2 desktop application with native Rust filesystem, SQLite FTS5 search, task queries, filesystem watching, backups, and workspace health checks.
- External workspace theme catalog and portable Windows/Linux release tooling.
- Editable portable `readme.md`, `changes.md`, and `theme.json` sidecars beside the executable, with embedded and legacy-workspace fallbacks.
- A persistent Working Tasks layout toggle for bottom-pane or resizable three-pane views, with a 20% minimum width per pane.
- Explicit calendar controls and clear buttons for Start, Completed, and Due task dates.
- Recoverable trash, atomic/versioned writes, crash drafts, verified streaming backups, version retention, safety tools, and read-only Git status.
- A typed `Ctrl+K` command palette with command/note/tag/help modes, ranking, arguments, unified shortcuts, and accessibility semantics.
- CodeMirror 6 Markdown editing with highlighting, folding, search/replace, multiple selections, completion, persistent line numbers, and per-document position restoration.
- Migrated native knowledge index with structured task/tag/link metadata, parameterized query filters, backlinks, saved searches, incremental watcher updates, and migration/performance tests.

### Changed

- The established RecallStack interface now runs through a modular Vite/TypeScript entry while retaining DOM and CSS parity with the original.

### Fixed

- Watcher read-event feedback loops, redundant repaints, stale async list updates, external editor conflicts, and desktop folder selection/close integration.
- Low-opacity task metadata icons, native date pickers remaining open after selection, Working Tasks pane dimensions not surviving shutdown, and a false SQLite-missing message during desktop startup.
- Stale last-opened file restoration displaying `Could not open file: undefined`; missing saved files now fall back silently to their folder.
- Uneven three-pane header heights and Preview collapsing additional consecutive Markdown blank lines.
- Copy names exposing task metadata after timestamp suffixes; duplicates and other filename collisions now use clean incrementing parenthesized numbers.
- Move dialog sizing now increases only its available width, preserving standard application font and control sizes.
- Journal and Daily Note filename fields are read-only, with save-time enforcement preventing renames.
- Markdown line numbers now default to visible, and reselecting the active workspace returns to its current folder/subfolder listing without asynchronously reopening the prior note.

### Known limitations

- Windows artifacts are unsigned unless release credentials are supplied.
- Platform smoke tests must run on native Windows and Arch Linux environments.

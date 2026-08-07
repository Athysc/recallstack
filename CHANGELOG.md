# Changelog

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

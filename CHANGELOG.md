# Changelog

## 0.1.0 — 2026-08-06

### Added

- Tauri 2 desktop application with native Rust filesystem, SQLite FTS5 search, task queries, filesystem watching, backups, and workspace health checks.
- External workspace theme catalog and portable Windows/Linux release tooling.
- Editable portable `readme.md`, `changes.md`, and `theme.json` sidecars beside the executable, with embedded and legacy-workspace fallbacks.
- A persistent Working Tasks layout toggle for bottom-pane or resizable three-pane views, with a 20% minimum width per pane.
- Explicit calendar controls and clear buttons for Start, Completed, and Due task dates.

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

### Known limitations

- Windows artifacts are unsigned unless release credentials are supplied.
- Platform smoke tests must run on native Windows and Arch Linux environments.

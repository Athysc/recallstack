# RecallStack Desktop App Recommendations

**Date:** 2026-08-06  
**Prepared for:** Athy  
**Source:** Review of `recallstack.html` from uploaded `recallstack.zip`

## Executive Summary

RecallStack is already more than a simple single-page HTML file. It is a local-first PKM-style web application with Markdown editing, workspace browsing, task/calendar functionality, assets support, themes, search/indexing, and SQLite-via-WASM support.

The best path forward is to turn it into a standalone desktop application while preserving its filesystem-first, Markdown-native architecture.

**Primary recommendation:** build **RecallStack Desktop** with **Tauri 2 + TypeScript + Rust + native SQLite**.

This keeps the current web UI direction, supports Windows and Arch Linux well, avoids Electron’s heavy runtime cost, and gives the application native filesystem, database, packaging, and workspace capabilities.

---

## Current Application Observations

From inspection, the uploaded app appears to be:

- A single-file HTML/CSS/JavaScript application
- A local-first PKM interface named **RecallStack**
- Uses the browser **File System Access API**:
  - `showDirectoryPicker`
  - `FileSystemDirectoryHandle`
- Uses browser storage:
  - `localStorage`
  - `IndexedDB`
- Uses **sql.js / SQLite WebAssembly** for `DB/index.db`
- Uses or expects local/CDN libraries such as:
  - `sql.js`
  - `marked`
  - `highlight.js`
  - `mermaid`
- Supports Markdown files, assets, tasks, themes, workspaces, search, calendar views, and note previews
- Expects a filesystem-oriented workspace layout, including folders such as `Data/` and `DB/index.db`

This makes it a strong candidate for a desktop app because the browser is currently acting as a constrained desktop shell.

---

## Recommended Direction

## Top Choice: Tauri 2 + TypeScript + Rust

Recommended stack:

```text
Frontend: TypeScript, HTML/CSS, optionally Svelte/React/Vue
Backend: Rust via Tauri commands
Database: Native SQLite
Packaging: Tauri bundler
Platforms: Windows and Arch Linux
```

### Why Tauri is the best fit

| Need | Tauri Fit |
|---|---|
| Windows app | Excellent |
| Arch Linux app | Excellent |
| Reuse current HTML/CSS/JS | Yes |
| Small app size | Much smaller than Electron |
| Native file access | Yes |
| Native SQLite | Yes |
| Local-first security | Strong |
| Long-term maintainability | Good |

Electron would be faster for a quick prototype, but Tauri is cleaner and more efficient for a serious long-term desktop app.

---

## Improvements for a Desktop Version

## 1. Replace Browser File Permissions with Native Filesystem Access

Current browser approach:

```js
showDirectoryPicker()
```

Desktop replacement:

- Native folder picker
- Reliable saved workspace paths
- Recent workspaces
- Auto-open last workspace
- Reveal file/folder in system file manager
- Native filesystem permissions instead of browser prompts

Better user experience:

```text
Open Workspace
Recent Workspaces
Pin Workspace
Auto-open Last Workspace
Reveal in File Explorer / Dolphin / Nautilus
```

---

## 2. Replace sql.js WASM with Native SQLite

Current approach:

```text
sql.js → SQLite compiled to WebAssembly → DB/index.db
```

Desktop replacement:

```text
Native SQLite through Rust or Node/Go/C# backend
```

Benefits:

- Faster indexing
- Lower memory usage
- Real transactions
- Better migration support
- Easier full-text search
- Safer database writes
- SQLite FTS5 support

Suggested future schema areas:

```sql
files
notes
tags
tasks
assets
links
backlinks
daily_journal
workspace_settings
```

Full-text search should use SQLite FTS5:

```sql
CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tags);
```

---

## 3. Keep Markdown Files as the Source of Truth

The desktop version should not become database-only.

Recommended architecture:

```text
Markdown files = canonical user data
SQLite index = fast searchable cache
```

This preserves compatibility with:

- Git
- Obsidian
- VS Code
- Neovim
- Other PKM tools
- Backup systems
- OpenBrain / notes repo workflows

The desktop app should enhance the filesystem, not trap user data inside a proprietary database.

---

## 4. Split the Monolithic HTML File

The current app combines CSS, HTML, JavaScript, file operations, database logic, search, rendering, task logic, calendar logic, themes, and state management in one file.

Recommended project structure:

```text
recallstack/
  src/
    app/
      main.ts
      state.ts
      router.ts
    features/
      notes/
      tasks/
      calendar/
      search/
      assets/
      workspaces/
      themes/
    services/
      filesystem.ts
      sqlite.ts
      markdown.ts
      settings.ts
      watcher.ts
    ui/
      components/
      modals/
      panes/
  src-tauri/
    src/
      main.rs
      commands/
        filesystem.rs
        sqlite.rs
        search.rs
        workspace.rs
```

This will make the app easier to maintain and extend.

---

## 5. Add Filesystem Watching

A desktop app can watch workspace files for external changes.

Examples:

- File changed outside RecallStack
- Git pull adds notes
- Asset moved
- Task renamed
- Database needs reindexing

Recommended backend capability:

```text
Workspace changed externally → refresh index automatically
```

In Rust/Tauri, use the `notify` crate, which supports:

- Linux/inotify
- Windows filesystem notifications
- macOS filesystem events if needed later

---

## 6. Add Real Installers and Packages

For Windows:

```text
RecallStack Setup.exe
RecallStack.msi
Portable .exe
```

For Arch Linux:

```text
AppImage
.tar.gz portable build
PKGBUILD / AUR package
```

Tauri supports these distribution paths well.

---

## 7. Add Backup and Safety Features

Because the app directly edits Markdown notes and assets, destructive operations should have safety rails.

Recommended features:

- Auto-backup before destructive operations
- Trash/recycle behavior instead of permanent delete
- Version history
- Git integration
- Recover unsaved changes
- Rebuild database command
- Workspace health checker

Useful desktop menu commands:

```text
Tools → Rebuild Search Index
Tools → Validate Workspace
Tools → Find Broken Links
Tools → Find Orphan Assets
Tools → Backup Workspace
Tools → Open Git Status
```

---

## 8. Add a Command Palette

A desktop PKM app should support a command palette:

```text
Ctrl+K / Ctrl+P
```

Suggested commands:

- Open note
- Create note
- Search tasks
- Jump to today
- Insert Mermaid block
- Toggle preview
- Rebuild index
- Switch workspace
- Change theme

This would immediately make RecallStack feel more like a native power-user application.

---

## 9. Improve the Editor

The current app appears to use a textarea-style Markdown editor. That is acceptable, but a desktop version should upgrade the editing experience.

Editor options:

| Editor | Notes |
|---|---|
| CodeMirror 6 | Best web-based Markdown editor choice |
| Monaco | Powerful but heavier |
| ProseMirror | Better for rich WYSIWYG |
| Milkdown | Markdown + WYSIWYG hybrid |
| TipTap | Rich editing, less Markdown-native |

Recommendation:

> Use **CodeMirror 6** first. Add WYSIWYG later only if needed.

CodeMirror gives:

- Markdown highlighting
- Optional Vim mode
- Better keyboard handling
- Search within file
- Folding
- Line numbers
- Better drag/drop and paste handling

---

## 10. Improve Search into a Knowledge System

The desktop version should upgrade search into a more serious PKM layer.

Recommended search features:

- Full-text search
- Tag search
- Folder search
- Task search
- Date search
- Recent files
- Backlinks
- Broken links
- Saved searches
- Graph view later

Example query syntax:

```text
tag:ai due:today
folder:tasks priority:high
is:task is:working
created:2026-08
"exact phrase"
```

---

# Language and Framework Options

## Option A — Tauri + TypeScript + Rust

**Top recommendation.**

```text
Frontend: TypeScript, HTML/CSS, maybe Svelte/React/Vue
Backend: Rust
Database: SQLite
Packaging: Tauri
```

### Pros

- Small binaries
- Native Windows/Linux builds
- Good local filesystem support
- Strong security model
- Fast, reliable Rust backend
- Can reuse much of the current UI
- Better long-term footprint than Electron

### Cons

- Rust learning curve
- Tauri command bridge requires structure
- Some Linux packaging quirks

### Best if

RecallStack is intended to become a polished, local-first desktop app.

---

## Option B — Electron + TypeScript

```text
Frontend: TypeScript/React/Svelte/plain JS
Backend: Node.js
Database: better-sqlite3
Packaging: Electron Builder
```

### Pros

- Fastest migration from current single HTML app
- Node filesystem APIs are easy
- Huge ecosystem
- Many desktop app examples
- Easy Markdown, SQLite, and file watcher libraries

### Cons

- Large app size
- Higher RAM usage
- Less elegant than Tauri
- More security footguns

### Best if

The priority is the fastest possible working desktop prototype.

---

## Option C — Wails + Go + TypeScript

```text
Frontend: TypeScript
Backend: Go
Database: SQLite
Packaging: Wails
```

### Pros

- Smaller than Electron
- Go is simpler than Rust
- Good filesystem tooling
- Good cross-platform story

### Cons

- Smaller ecosystem than Tauri/Electron
- Less popular
- UI is still web-based

### Best if

You like Go and want a simpler backend than Rust.

---

## Option D — C# + Avalonia

```text
Language: C#
UI: Avalonia
Database: SQLite
Platform: Windows/Linux/macOS
```

### Pros

- True desktop UI
- Excellent Windows support
- Good Linux support
- Good performance
- Mature tooling

### Cons

- Requires rewriting the UI from scratch
- Less reuse of current HTML/CSS
- Markdown editor integration takes more work

### Best if

You want a more traditional native desktop application and are willing to rebuild the UI.

---

## Option E — Flutter + Dart

```text
Language: Dart
UI: Flutter
Database: SQLite
Platform: Windows/Linux
```

### Pros

- Beautiful custom UI
- Good cross-platform support
- Single codebase
- Good packaging

### Cons

- Full rewrite
- Markdown editor complexity
- Desktop text editing can feel less native
- Not ideal if preserving the current web UI matters

### Best if

You want a visually custom application and are comfortable rewriting.

---

## Option F — Qt / PySide / C++ / Python

```text
UI: Qt
Language: Python or C++
Database: SQLite
```

### Pros

- Mature desktop framework
- Good file dialogs, menus, and native integrations
- Python version is quick to build

### Cons

- Packaging Python desktop apps can be annoying
- UI rewrite required
- Markdown editor/preview integration takes work

### Best if

You prefer traditional desktop frameworks or Python/C++.

---

# Ranked Recommendation

| Rank | Stack | Why |
|---:|---|---|
| 1 | Tauri + TypeScript + Rust | Best long-term fit |
| 2 | Electron + TypeScript | Fastest working desktop version |
| 3 | Wails + Go + TypeScript | Good middle ground |
| 4 | C# + Avalonia | Strong native desktop rewrite |
| 5 | Flutter | Great UI, but larger rewrite |
| 6 | Qt/Python | Useful, but packaging can be messier |

---

# Practical Migration Plan

## Phase 1 — Wrap It as a Desktop App

Goal: get the current app running as a desktop app with minimal changes.

Use either:

- Tauri
- Electron

Tasks:

- Move `recallstack.html` into a proper project
- Split CSS and JS into separate files
- Bundle local copies of:
  - `sql.js`
  - `marked`
  - `highlight.js`
  - `mermaid`
- Remove CDN dependency
- Add desktop folder picker
- Package for Windows and Arch Linux

Result:

```text
RecallStack opens as a desktop application.
Existing UI mostly unchanged.
```

---

## Phase 2 — Replace Browser APIs

Replace:

```text
showDirectoryPicker()
FileSystemDirectoryHandle
IndexedDB workspace handle storage
sql.js
```

With:

```text
Native folder picker
Native filesystem backend
Settings file
Native SQLite
```

Result:

```text
RecallStack becomes a true desktop app, not just a browser page in a shell.
```

---

## Phase 3 — Refactor into Modules

Split the code into:

- Workspace service
- Note service
- Task service
- Asset service
- Search service
- SQLite service
- UI components

Result:

```text
Maintainable app.
Easier to add features.
Less risk of breaking everything.
```

---

## Phase 4 — Add Desktop-Grade Features

Recommended features:

- Command palette
- Global search
- Backlinks
- Graph view
- Git sync/status
- Workspace health checker
- Auto-backup
- System tray optional
- Native menus
- Recent files
- Multi-window note editing
- Better keyboard shortcuts
- Plugin system eventually

---

# Proposed MVP

## RecallStack Desktop MVP

Recommended stack:

```text
Tauri 2
TypeScript
Rust
SQLite
CodeMirror 6
Marked
Mermaid
Highlight.js
```

MVP features:

- Open workspace folder
- Browse notes
- Edit Markdown
- Live preview
- Save files
- Assets folder support
- Task metadata support
- Calendar view
- SQLite FTS search
- Theme selection
- Recent workspaces
- Windows build
- Arch Linux AppImage or PKGBUILD

---

# Workspace Layout Recommendation

If preserving compatibility with the current app and existing notes workflows, keep the current style:

```text
Workspace/
  Data/
    personal/
    projects/
    tasks/
  DB/
    index.db
```

If starting fresh, a cleaner future layout could be:

```text
RecallStack Workspace/
  notes/
  tasks/
  assets/
  db/
    recallstack.db
  .recallstack/
    settings.json
    backups/
```

However, if RecallStack is meant to integrate with Athy’s current `~/notes` / OpenBrain structure, preserving compatibility is better than forcing a new layout.

---

# Product Direction

RecallStack could become:

> A local-first PKM desktop app for Markdown notes, AI-team outputs, tasks, journals, and OpenBrain-style knowledge work.

Potential differentiators:

- Filesystem-first
- Markdown-native
- SQLite-indexed
- AI-team/workspace aware
- Offline-first
- Does not trap data
- Runs on Windows and Arch Linux
- Designed for power users, not casual note-takers

---

# Final Recommendation

Do **not** rewrite everything immediately.

Recommended sequence:

1. Start with a **Tauri desktop shell**.
2. Preserve the current UI and behavior where possible.
3. Replace fragile browser-only APIs one at a time.
4. Move SQLite from WASM to native SQLite.
5. Refactor the app into maintainable modules.
6. Add desktop-grade search, backup, workspace, and command-palette features.

This gives RecallStack a realistic path from single-page HTML app to serious Windows + Arch Linux desktop application without throwing away the working prototype.

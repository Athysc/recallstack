# RecallStack — Change Log

---

## Version 0.1.4 — 2026-08-27 (unreleased)

### Modal listing windows (Notes / Tasks / Working Tasks)

Note, task, and working-task browsing all move into a centered listing modal —
80% of the window width, 60% of its height — leaving the editor and preview
visible behind it. Coded-jump navigation throughout (`J`/`K` or arrows, letter
codes, `Enter` open, `Ctrl+Enter` pin, `Esc` close).

- **Task listing** (`Ctrl+T`, or the Task icon in Nav Row 1) — the workspace
  `tasks/` folder, split into **Tasks / Completed / In QA Review / Marked for
  Deployment / Deployed / Backlog & Deferred** sections, each row color-coded by
  priority. Row button is **→ Working** in the Tasks section and **Archive** in
  the status sections.
- **Working Task listing** (`Ctrl+W`, or the colored Working Tasks icon) —
  `tasks/working/`, color-coded, with a **← Task** button per row.
- **Notes listing** (`Ctrl+L`) — the currently selected folder's notes. Clicking
  a folder or subfolder in the nav bar opens it automatically; Inbox and Outputs
  keep the inline list. Row button is **Archive**.
- Every listing has a **Sort** header button (A–Z ↔ Modified, remembered per
  listing) and — for Tasks and Notes — a **Show archived** toggle that switches
  the list to the `archived/` folder, where each row's button becomes
  **Restore**. Acted-on rows drop off immediately; the modal stays open until a
  file is chosen.

### Working Tasks pane removed

The resizable left/bottom **WORKING Tasks** pane, its layout toggle, its
sort/completed controls, and the **Working Tasks Layout** settings tile are
gone — the listing modals replace them. The related persisted preferences
(`pkm-working-pane-*`, `pkm-working-show-completed`, `pkm-working-sort`) are no
longer used.

### Keyboard shortcut reference and remap

- **`Ctrl+K`** now opens a **Keyboard Shortcuts** sheet listing every binding,
  grouped by category.
- The command palette moves to **`Ctrl+P`** (command-search `>` mode only; the
  old `@` quick-open-notes shortcut is dropped — type `@` in the palette).
- **`Ctrl+J`** opens the Daily Journal (was `Ctrl+L`).
- **`Ctrl+L`** opens the Notes listing modal for the current folder.
- **`Ctrl+Shift+T`** opens the theme switcher.
- **`Ctrl+Q`** (and `Ctrl+Shift+W`) closes the current tab (was `Ctrl+W`).
- **`Ctrl+I`** opens Open / Import Files.
- **`Ctrl+/`** focuses workspace search; blockquote toggle in the editor moves
  to **`Ctrl+'`**.
- **`Ctrl+Z` / `Ctrl+Shift+Z`** undo / redo now cover the structural editor
  commands (list continuation, indent/outdent, delete-line, blockquote, insert)
  — up to 50 steps — which previously bypassed the undo history entirely.
- **`Ctrl+O`** is unbound.
- Controls that have a shortcut now show it in their hover tooltip.

### New-file picker

**`Ctrl+N`** (and **+ New**) open a small picker: **New Note**, **New Task**,
**New Working Task**, in that order. Arrow keys select; `Enter` creates; quick
keys `n` / `t` / `w` jump and create.

### Live theme switcher

**`Ctrl+Shift+T`** opens a theme list that previews each theme across the whole
app as you arrow through it. `Enter` applies and saves for the workspace; `Esc`
reverts.

### External theme file

**Settings → External theme file** points RecallStack at a JSON file of extra
themes, merged with the built-ins and remembered across restarts. One file may
hold many themes; ids that collide with a built-in are skipped. **Use sample
themes** loads the bundled **Lupine** and **Osaka Jade** themes (from Omarchy
Quattro).

### Escape and the default view

`Esc` closes any open palette or modal and returns to the current file; with
nothing open it saves and jumps to today's Daily Journal. When no note, task, or
working task is open, RecallStack shows the Daily Journal instead of an empty
file list.

---

## Version 0.1.3 — 2026-08-12

### Workspace Tasks and Daily Journals

Tasks now live in one workspace-level `tasks/` folder and Daily Journals now live in one workspace-level `dailylogs/` folder. RecallStack checks for both system folders every time a workspace is loaded and creates either one when it is missing. The reserved `tasks` and `dailylogs` names are protected from normal folder creation and renaming.

The Daily Journal control opens or focuses the current date journal file. Today’s journal is kept as the first pinned tab, cannot be moved, and cannot be closed. Press **Ctrl+L** to jump back to it at any time. If you click **+ New** or press **Ctrl+N** while the Daily Journal is active, RecallStack now creates a normal task markdown file in `tasks/` instead of treating the journal as the new-file destination.

### Tasks Navigation and Keyboard Remaps

The Tasks icon now opens the old sectioned workspace task listing backed by `tasks/`, including **Working Tasks**, priority/status sections, **Completed**, **In QA Review**, deployment/deployed sections, and **Backlog / Deferred**. The list view keeps **+ New** enabled; creating from that view writes a task markdown file to `tasks/`.

The Daily Journal and Tasks icon buttons were reordered to match the current navigation layout. The obsolete top-level **Outputs** text button was removed; Outputs remains available as the compact header icon beside workspace refresh.

Keyboard shortcuts were updated:

| Shortcut | Current action |
|---|---|
| **Ctrl+O** | Open the compact Tasks quick-open selector |
| **Ctrl+T** | Switch to the sectioned Tasks list view |
| **Ctrl+L** | Open or focus today’s pinned Daily Journal |
| **F12** | Toggle presentation mode |

### Display, Search, and Editor Polish

The Display & Navigation modal has been restored to the intended layout: the 3×3 tile grid stays together, the theme list is back in its right-side panel, and the Outputs folder controls sit below the tile grid. The Working Tasks header controls now wrap instead of clipping when the left pane is narrow.

Search results now support keyboard navigation: **J/K** or arrow keys move the selected result, **Enter** opens it, **Escape** exits back to the prior view, and displayed one- or two-letter jump codes open a result instantly. Search results also continue to show which files are already open in tabs.

The Markdown editor no longer exposes CodeMirror’s bottom find/replace panel from its built-in search keymap. RecallStack’s workspace search remains available from the top search box, **Ctrl+Shift+F**, and **Ctrl+F**. The editor caret now has a subtle glow, and the active line keeps its highlight with a slight text glow.

### Outputs and Release Notes

Outputs can be configured in Display & Navigation and defaults to `<workspace path>/openbrain/outputs`, which is created automatically when missing. The in-app User Guide and What's New documents have been updated to match the current shortcuts, navigation model, Tasks behavior, search-result keyboarding, and editor appearance.

---

## Version 0.1.2 — 2026-08-11

### Faster Startup and Large Workspaces

The Markdown editor is now loaded when the first real document opens instead of during application startup. Large image, audio, video, and PDF previews stream directly from a workspace-sandboxed local protocol with byte-range support, avoiding binary number-array transfers through JavaScript. Preview updates use adaptive idle scheduling so rapid typing and hidden editor views perform less unnecessary rendering.

Outputs listings and orphan-asset checks now use bounded native bulk operations. Nested Outputs folders require one metadata call, and orphan checks scan Markdown in Rust and return only referenced asset names. Folder renames are now a single native atomic operation instead of recursively copying every file through the WebView before deleting the old folder.

Production verification enforces a 320 KB minified startup-JavaScript budget and prevents CodeMirror from becoming a startup preload. Native Windows and Linux release jobs also time a private-data-free 1,003-note workspace and attach machine-readable results to their artifacts.

### Tabs and Navigation

Clicking a note or task that is already open now reliably returns to its editor. A new vector icon beside Outputs restores the most recently selected tab from any folder list, including loading that tab again when necessary.

The selected tab title is now bold and uses a theme-derived, contrast-adjusted accent so it remains easy to identify in both light and dark themes. Selecting any calendar day now places a **Journal / Daily Log** button first in the day's panel; it opens that date's journal and creates the saved entry when needed.

Press **Ctrl+Space** anywhere in the main application to open the new Open Tabs selector. It highlights the current tab, supports arrow keys or Vim-style **J/K** navigation and Enter, restores the prior focus on Escape, and shows compact one- or two-letter codes that switch immediately when typed. **X** closes the highlighted tab and refreshes both the selector and tab bar without dismissing the selector until its final item is closed; jump codes always exclude J, K, and X.

Creating a note, task, or Working Task now opens a filename prompt sized to 60% of the application window. The generated dated title is selected without showing `.md`; Enter creates it with the extension automatically, typing replaces it with a custom title, and Escape cancels without creating a file. Task and Working Task files receive their complete default metadata suffix as soon as they are created.

### Internal Reliability

The desktop asset protocol rejects paths outside the active workspace, limits served content types, and supports bounded range requests. Toast, dependency status, and editor preview scheduling now live in focused typed modules, and the obsolete monolithic runtime fixture and completed implementation-plan documents have been removed. The production frontend cutover is now complete: the application controller is included in strict TypeScript compilation, no production source uses TypeScript checking suppressions, and a regression test preserves that boundary.

Windows and Linux now apply the same portable-name and case-collision rules when creating or renaming notes and folders. Final security hardening also moved Outputs path rendering to safe DOM properties, added symbolic-link containment to primary native note commands, and explicitly enabled Mermaid's strict security mode.

## Version 0.1.1 — 2026-08-07

### Editor and Preview Screen-Share Zoom

The footer now includes an **Editor/Preview zoom** picker. Default keeps content
at 100%; the ten additional increments enlarge Markdown editor text and the
complete rendered preview from 110% through 200%. Preview images, Mermaid
diagrams, tables, and code blocks scale with the text while pane headers,
toolbars, navigation, Working Tasks, and the rest of the interface stay at their
normal size. The selected zoom persists across application restarts. Preview
content now uses the full current pane width and reflows when either divider is
moved, including code blocks, tables, images, and Mermaid diagrams.

### Reviewed Portable Builds

The manually started GitHub Actions workflow now uses Node 24 throughout and
produces separate Windows portable and Linux artifacts. Windows-specific release
checks accept CRLF line endings, and native index tests close SQLite handles
before cleaning up their temporary databases. These changes remove the
cross-platform verification and file-in-use failures found during the first
reviewed builds without enabling automatic releases from pushes.

### Arch Linux Build Documentation

The repository and User Guide now include the complete Arch Linux dependency
installation, release verification, native tarball, AppImage, generated
`PKGBUILD`, launch, and FUSE troubleshooting steps.

## Version 1.5 — 2026-08-06

### Safety, Commands, Editor, and Knowledge Search

Deletes now move files, folders, and assets into recoverable RecallStack Trash. Native writes are atomic and conflict-aware, unsaved drafts survive crashes, prior note versions are retained, and Safety & Workspace Tools provides restore, verified streaming backups, workspace validation, index rebuild, and read-only Git status.

Press **Ctrl+K** for the new keyboard command palette. It supports command ranking and history, disabled-action explanations, note (`@`), tag (`#`), help (`?`), and theme-selection modes. **Ctrl+P** opens note mode directly.

The Markdown textarea has been replaced with CodeMirror 6, adding syntax highlighting, search/replace, folding, bracket matching, undo/redo, multiple selections, optional line numbers, persistent document position, and note/tag completion while retaining the existing preview and asset workflows.

Desktop search now uses the native, incremental SQLite/FTS5 knowledge index. Searches support structured filters such as `tag:`, `folder:`, `is:task`, `is:working`, `priority:`, `due:overdue`, `modified:>=YYYY-MM-DD`, and link filters. Results include metadata, built-in and user-saved searches are available, and open notes display backlinks.

Markdown line numbers are now enabled by default and can still be disabled from the editor toolbar. Clicking the already-active workspace now returns to the normal listing for its currently selected folder and subfolder, without briefly reopening the previously selected note.

## Version 1.4 — 2026-08-06

### Portable Desktop Sidecars

The portable distribution now includes `readme.md`, `changes.md`, and `theme.json` beside the executable. RecallStack reads these files directly, so the in-app User Guide, What's New history, and theme catalog remain editable without placing application files inside a workspace.

Embedded defaults and legacy workspace files remain available as fallbacks if a sidecar is missing or unreadable. Invalid theme catalogs are never overwritten automatically.

### Native Filesystem Watching

External note changes now use batched, workspace-relative watcher events with targeted refreshes. Clean open notes reload safely; dirty notes keep the editor buffer and offer Compare, Reload from disk, and Keep my version controls.

### Visible and Clearable Task Dates

Start, Completed, and Due dates now have explicit calendar buttons that remain visible across desktop WebView implementations. A clear (×) button appears beside any populated date so it can be removed without editing the task filename.

### Three-Pane Working Tasks Layout

A new layout toggle beside **Show or Hide Working Tasks** moves the Working Tasks pane between its original bottom position and a left-side layout: **Working Tasks | Markdown | Preview**. Both dividers are draggable, every pane keeps at least 20% of the application width, and the selected layout is remembered.

The Working Tasks visibility, bottom-pane height, and three-pane widths now also persist across application shutdowns. The alphabetical sort and New Working controls use compact vector icons.

### Desktop Control and Startup Fixes

Task metadata label icons are now fully visible and consistently sized. Start, Completed, and Due use a RecallStack calendar with explicit Today, Clear, and Close actions; choosing a date closes it immediately without relying on inconsistent native WebView picker behavior. Desktop startup no longer briefly reports the browser SQLite library as missing while the native Rust SQLite backend is loading.

Last-view restoration now treats a previously opened file that was moved or deleted outside RecallStack as a stale preference. It returns to the saved folder instead of displaying `Could not open file: undefined`.

### Consistent Pane Headers and Markdown Spacing

The Working Tasks, Markdown, and Preview header banners now share the same height in three-pane mode. Preview also preserves additional consecutive blank lines from Markdown while leaving normal single separators and blank lines inside fenced code unchanged.

### Larger Move Dialog and Predictable Duplicate Names

The Move File dialog is now 50% wider so long filename labels fit without enlarging its typography or controls. Copies and collision-safe moves now use `Name (2)`, `Name (3)`, and so on across regular notes, tasks, and other files instead of timestamp suffixes. Task copies retain their metadata in the valid internal filename position, so Start, Completed, Due, and Priority suffix data no longer appears in the displayed title.

### Locked Journal Filenames

Journal and Daily Note filenames are now read-only because their paths and names identify their calendar date. Their Markdown content remains editable, and the save path independently prevents a filename change even if the interface value is modified programmatically.

---

## Version 1.3 — 2026-08-05

### Working Tasks and Daily Journal

Tasks can now be moved into a dedicated `tasks/working/` queue. The task editor shows a **WORKING** indicator; click it to return an active task to the main Tasks list. When you mark a working task complete, it automatically moves back to the parent `tasks/` folder.

When editing in Tasks, a resizable **WORKING Tasks** pane lists active working tasks, optionally shows recently completed tasks, and includes a **Journal / Daily Notes** shortcut. The shortcut opens today’s journal entry under `tasks/journal/YYYY/MM/`, creating it when needed and carrying forward the most recent journal content when there is no entry for today.

### Safer Working-Task Toolbar

Working tasks no longer show controls that would take them out of their workflow: stamp date in filename, convert to task, make copy, move, archive/restore, and delete. They remain editable, savable, and can be returned to the regular Tasks list with the **WORKING** indicator.

### Working Tasks at the Top of the Tasks List

Before a task is opened, the Tasks list now shows **Working Tasks** first. It uses the same task-card layout as the other sections, with a theme-aware peach accent, and remains visible even when working tasks are the only tasks in the folder.

### Task Metadata in Filenames

Task priority and dates are now stored in the task filename rather than injected into the markdown body. The Task Date Bar continues to manage them, preserving existing task content while keeping list and calendar metadata in sync.

---

## Recent Updates

### Faster Task Date Marking

New compact calendar-action buttons beside **Start Date** and **Completed Date** set the respective field to today without opening its date picker. Setting Completed Date still fills in Start Date with the same date when the task does not already have one.

### Cleaner Task Controls

Quick date, Priority, and Status controls now use transparent backgrounds. Priority and Status stay borderless until selected, when the active option receives a color-matched outline.

---

## Version 1.2 — 2026-05-27

### Editor Toolbar Copy Helpers

**Copy selected file path**
A new toolbar icon next to **Copy HTML** copies the currently selected markdown file's full filesystem path to the clipboard as markdown inline code, for example:

```md
`/home/scdev/notes/Data/personal/example.md`
```

This makes it easy to paste an exact file reference into another note, chat, task, or external app.

**Copy RecallStack internal link**
A second new toolbar icon copies a markdown link to the selected file. Paste that link into another RecallStack note; when the note is rendered in the preview panel, clicking the link opens the target markdown file directly inside RecallStack.

Internal links use an app-local `#recallstack-open=...` target so they stay self-contained inside RecallStack instead of launching an external browser route.

---

## Version 1.1 — 2026-05-15

### Auto-Save

The app now automatically saves your work in three layers so you never lose a change, even if something unexpected happens.

**On file switch**
When you click a different file (or hit New Note) while editing, the current file is saved automatically before switching away. The Save button behaviour is completely unchanged — this is additive.

**Debounced save while typing**
While you are actively editing, the app saves silently 1.5 seconds after you stop typing. The Save button briefly flashes "Saving…" as confirmation, but no toast pops up so it doesn't interrupt your flow.

**Tab visibility events**
When you switch browser tabs, minimise the window, or lock your screen, the app fires an immediate save. If you close the tab those same events fire first, giving the save a chance to complete before the page unloads.

**Crash-recovery draft buffer**
Every keystroke is written to `localStorage` (a fast, synchronous operation that costs almost nothing). If the browser crashes or the tab is force-killed before the file can be flushed to disk, the draft survives. The next time you open that file you will be prompted: *"Unsaved draft found — restore changes?"* — Yes restores your work, No discards the draft and won't ask again. The draft is cleared automatically on every successful save.

> `localStorage` can be blocked in Safari Private mode or under strict "Block all cookies" settings. The buffer is wrapped in `try/catch` so the app degrades gracefully — the other two save layers still protect you.

---

### Local/Web Library Loading and Status Bar

RecallStack now shows a compact **Libraries** status bar along the bottom of the app so you can see which JavaScript dependencies are loaded, missing, lazy-loaded, or still loading.

| Library | Purpose | Default source |
|---|---|---|
| sql.js + WASM | In-browser SQLite database | Web by default, local toggle available |
| marked.js | Markdown → HTML rendering | Local |
| highlight.js | Syntax highlighting | Local |
| Mermaid | Diagram rendering | Local |

Each status chip displays **`(local)`** or **`(web)`** in text so the source is easy to read. Any dependency error text is displayed after the final chip instead of inside a chip.

**SQLite source toggle:** SQLite is web-first by default because browsers can block local `file://` WebAssembly loads. A tiny button next to the SQLite chip toggles between web and local, saves the preference, and reloads the app so the selected startup source takes effect.

Manual controls:

```js
localStorage.setItem('pkm-sql-source', 'local')   // force local SQLite
localStorage.removeItem('pkm-sql-source')         // return to web default
```

**Keeping local copies up to date:** The CDN URLs in the HTML are version-pinned, so a local copy downloaded today matches exactly what the CDN would serve for that version indefinitely. When you deliberately want to bump a library to a newer version, update the URL in the HTML and run:

```
./Apps/lib/update-libs.sh
```

This re-downloads all bundled libraries and rebuilds the highlight.js full bundle in one step.

---

### Syntax Highlighting — Full Language Support

The common highlight.js build included with the app supports 36 languages (bash, Python, JavaScript, TypeScript, Rust, Go, SQL, YAML, etc.). A full bundle covering all 192 supported languages is now available.

**How it works:**

- Common languages highlight instantly — no network request needed.
- If you use a fenced code block with a language that isn't in the common set (e.g. ` ```haskell `, ` ```dockerfile `, ` ```elixir `), the app fetches just that one small language file (~2–5 KB) from the CDN in the background.
- The preview re-renders with full highlighting as soon as the file arrives.
- If the CDN is unreachable (offline), the full local bundle (`lib/highlight.full.min.js`, 1.2 MB, all 192 languages) is loaded instead.
- Once the full bundle is loaded, all subsequent unknown languages are available instantly for the rest of the session.

**Full language list (156 extras beyond the common 36):**
1c, abnf, accesslog, actionscript, ada, angelscript, apache, applescript, arduino, armasm, asciidoc, autohotkey, awk, bash, basic, bnf, brainfuck, c, clojure, cmake, coffeescript, crystal, css, d, dart, delphi, diff, django, dockerfile, dos, dust, ebnf, elixir, elm, erlang, excel, fortran, fsharp, gherkin, glsl, go, graphql, groovy, haml, handlebars, haskell, haxe, http, hy, ini, java, javascript, json, julia, kotlin, latex, less, lisp, llvm, lua, makefile, markdown, mathematica, matlab, mercury, mipsasm, nginx, nim, nix, objectivec, ocaml, openscad, perl, php, plaintext, powershell, prolog, properties, protobuf, python, r, reasonml, ruby, rust, sas, scala, scheme, scss, shell, smalltalk, sql, swift, tcl, thrift, typescript, vala, vbnet, vbscript, verilog, vhdl, vim, wasm, xml, xquery, yaml, zephir, and more.

---

### App Renamed — RecallStack

The app has been renamed from *scdev PKM* to **RecallStack**. The HTML file is now `recallstack.html`. All internal references (IndexedDB name, default title, header display) have been updated.

---

### Recent Polish and Regression Fixes

**Bracketed bare URLs render correctly**
Bare URLs wrapped in square brackets, such as `[https://example.com]`, now render as one clickable link with the brackets included in the visible label instead of leaving the opening bracket outside the anchor or encoding the closing bracket into the URL.

**Reopen workspace restored**
The saved workspace **Reopen** flow has been checked and restored so a previously granted workspace can be reopened from the welcome screen.

**Title-field Tab behaviour**
Pressing `Tab` in the title / filename field now moves focus to the markdown editor at line 1, character 1.

**Dependency error visibility**
Dependency failures now surface as readable text in the bottom Libraries bar, after the final chip, instead of being hidden in tooltips or cramped inside a chip.

**Root-level notes are visible and editable**
Nav Row 2 now includes a special **root** button for every selected top-level folder. It lists markdown files saved directly inside that top-level folder, supports opening/editing them normally, and creates new notes directly in the top-level folder when root is active.

**Move dialog supports root destinations**
The Move popup now includes **root** as a destination for normal notes. Selecting it moves the file directly into the selected top-level folder rather than a subfolder, with distinct theme-aware styling so it stands out from normal subfolders.

**Root notes cannot be archived**
When the active note is directly in the top-level folder/root, the editor Archive button is hidden and guarded in code. The Nav Row 2 archive-toggle button is also hidden while root is selected.

**Mermaid label clarified**
The dependency status bar now labels the diagram library as **Mermaid** instead of the generic **Diagrams**.

---

### What's New Modal

A clock/history icon button (to the right of the User Guide button) opens the **What's New** panel, which renders `Apps/changes.md` using the same styled markdown renderer as the User Guide.

Each version heading has a **Copy** button on the right. Clicking it copies the full rendered HTML for that version section to the clipboard, formatted so it can be pasted directly into an email or document with formatting intact.

---

### Unsaved New Note Protection

If you create a new note, type content, and then navigate away without saving, the app now warns you:

- Clicking another file, folder, subfolder, workspace, or All Tasks shows a confirmation dialog:
  - **OK** — saves the note immediately (a timestamp title is generated automatically if the title field is blank), then navigates
  - **Cancel** — returns you to the note with your content intact
- Pressing **Cancel** (the editor button) or **Escape** discards the note silently, as expected — no prompt

This protection does **not** apply to existing saved notes since those are auto-saved continuously.

---

### Asset Migration on File Move

When a markdown file is moved to a different folder, any assets it references (images, attachments) are now moved alongside it into the destination's `assets/` folder. Previously, assets stayed in the source folder and became broken links after the move.

- Only assets **referenced in the file being moved** are relocated — unreferenced files in `assets/` are left in place.
- The destination `assets/` folder is created automatically if it does not already exist.
- Assets are removed from the source folder after a successful copy.
- Handles `archived/` sub-folders correctly (which use `../assets/` relative paths).

---

### Bug Fixes

A two-pass audit of the entire codebase found and fixed 30 bugs spanning data integrity, file handling, async correctness, and UI consistency.

#### Critical

**Concurrent save race (file corruption)**
The auto-save timer (1.5 s debounce) and a manual Ctrl+S could run `saveNote` simultaneously, causing two `createWritable()` calls to race on the same file — potentially producing a zero-byte or corrupted file. A `saveInProgress` mutex now gates the function so only one save runs at a time.

**Folder rename: state corrupted on partial failure**
When renaming a folder (copy-then-delete strategy), the nav state variables `l1Active.name` and `l2Active.name` were updated before the new directory handle was confirmed. If the handle lookup failed after the delete, the app's nav was permanently out of sync with disk. The handle is now awaited and confirmed before any state mutation.

#### High

**File handles left open on write failure**
`writeMdFile`, `saveAsset`, and `copyDirRecursive` all created a writable stream but had no `try/finally` to guarantee `close()` was called when `write()` threw. In Chromium this leaves the file locked until the tab closes. All three now use `try { write } finally { close }`.

**Search index empty after workspace switch**
`buildSearchIndex()` was called without `await` in `switchWorkspace`, so the index was still being built when the first search ran. Fast double-switches also raced two concurrent index builds, mixing results from both workspaces. The call is now properly awaited.

**Task card click saved to wrong folder**
When clicking a task card in All Tasks view, `l1Active` and `l2Active` were mutated to point at the task folder *before* `openFile` triggered `autoSaveIfDirty`. Any unsaved changes were written to the task folder instead of the note's actual folder. `openTaskEntry` now saves the current file before touching nav state.

**Archive, restore, and convert-to-task ignored unsaved editor content**
`archiveNote`, `restoreNote`, and `convertNoteToTask` all called `readMdFile()` (reading from disk) instead of using `mdEditor.value`. Unsaved edits were silently discarded. Each now saves first via `saveNote()` and works from the editor content.

**Folder rename did not update the database or search index for sibling files**
After renaming a top-level folder, only the currently open file was re-registered. All other `.md` files under the folder kept stale paths in SQLite and in the in-memory search index, causing search results to point to paths that no longer existed. A bulk SQL `UPDATE` and an in-memory loop now rename all entries atomically after a successful rename.

**File creation date destroyed on every save**
`INSERT OR REPLACE` (SQLite) deletes the old row before inserting a new one, wiping `created_at` on every save. Replaced with `INSERT OR IGNORE` + `UPDATE` so `created_at` is written once and never touched again.

**Tags silently dropped when file ID could not be retrieved**
After the `INSERT OR REPLACE`, `last_insert_rowid()` was used to get the file ID for tag insertion. In edge cases this returned the wrong ID or null, causing tags to be silently skipped. Now uses `SELECT id FROM files WHERE file_path=?` for a reliable lookup.

**`makeCopy` proceeded even when save failed**
`saveNote` caught its own errors internally and did not rethrow, so the `if (!currentPath)` check in `makeCopy` always passed. `saveNote` now returns `true`/`false` and `makeCopy` aborts if the save failed.

**Blob URLs revoked while the preview was still rendering**
`loadAssetsForCurrentFile` revoked all existing blob URLs immediately on entry, before the new asset set was ready. If a render cycle was in flight, images already resolved to the old URLs broke. Old URLs are now collected first and revoked only after the new asset map is fully populated.

**`moveAssetsWithFile` silently overwrote existing assets at the destination**
`getFileHandle(name, { create: true })` on the destination overwrote any file with the same name without warning, then deleted the source — unrecoverable data loss. The move now skips the asset if the destination already has a file by that name, leaving both copies intact.

**`moveCurrentFile` wrote broken asset links when crossing archive boundaries**
Moving a file into or out of `archived/` (which uses `../assets/` relative paths) wrote the content verbatim. Links in the moved file immediately pointed to the wrong relative location. The move now detects the source/destination archive status and rewrites `](assets/` ↔ `](../assets/` accordingly, matching the behaviour of `archiveNote` and `restoreNote`.

**Orphan asset detector could flag referenced assets as orphans**
The orphan scan only looked for `.md` files at the folder root and inside `archived/`. Any `.md` files in other subfolders were missed, causing their referenced assets to appear unreferenced — clicking "Delete all orphans" would have deleted live assets. The scan is now fully recursive (excluding `assets/` itself).

**`convertNoteToTask` left assets orphaned**
When converting a note to a task (moving it to the `tasks/` subfolder), referenced images and attachments were never moved. The converted task file had broken asset links immediately. `moveAssetsWithFile` is now called as part of the conversion.

#### Medium

**Workspace-scoped draft keys**
Draft recovery keys now include the active workspace name so files with the same relative path in different workspaces do not collide in `localStorage`.

**Remote media is gated more consistently**
Preview rendering now blocks remote image/audio/video/source/track/picture media unless the user explicitly allows remote media, reducing accidental network leaks.

**Optional SQLite no longer blocks workspace reopen indefinitely**
SQLite initialization is tracked in the Libraries bar, uses a timeout instead of staying in loading state forever, and reports errors as readable text.

**Restored draft did not update the saved-content baseline**
After confirming "restore draft?" in `openFile`, `mdEditor.value` was set to the draft but `savedContent` still held the disk version. The auto-save dirty check (`mdEditor.value === savedContent`) treated the file as perpetually dirty. `savedContent` is now updated to the draft value after restoration.

**Several async functions called without `await`**
`loadFiles`, `loadAllTasks`, and `newNote` were called without `await` in `cancelEdit`, `setSortMode`, `selectAllTasks`, the search debounce timer, and the New Note button handler. Errors were silently swallowed and, in the search case, concurrent calls could interleave DOM writes and produce a garbled file list. All call sites now attach `.catch()` handlers.

**Pressing Escape on a modal also closed the editor**
The global `keydown` handler ran `cancelEdit()` on Escape unconditionally. When the Markdown Reference, User Guide, or What's New modal was open over the editor, Escape dismissed the editor as well as (or instead of) the modal. The handler now checks whether any modal is visible before acting.

**New notes were not protected by the crash-recovery draft buffer**
`lsDraftSave` returned early when `currentPath` was null, so content typed into a new note was never written to `localStorage`. A browser crash or forced refresh before first save lost everything. New notes are now buffered under a sentinel key (`pkm-draft:__new__`).

**Escape keydown listener stacked when a modal was opened twice**
`openMdRef`, `openReadme`, and `openChangelog` called `document.addEventListener` each time without removing a prior listener. If the modal was opened while already visible, duplicate Escape handlers stacked. Each open function now calls `removeEventListener` before `addEventListener`.

**README and changelog showed previous workspace's content after a workspace switch**
`readmeLoaded` and `changelogLoaded` were never reset, so switching workspaces and opening either modal showed cached content from the prior workspace. Both flags are now cleared in `switchWorkspace`.

**Archive mode toggle did not refresh the file list when no subfolder was selected**
`toggleArchiveMode` only called `loadFiles` when `l2Active` was set. With only a top-level folder active, toggling archive mode changed the button state but left the file grid unchanged. The reload now also fires when only `l1Active` is set.

**Move modal offered `archived/` and `assets/` as valid destinations**
The subfolder list in the Move File dialog included `archived` and `assets`, which are not valid destinations for `.md` files. Both are now filtered out.

**Archive/restore link rewriting mangled content inside code fences**
`archiveNote` and `restoreNote` used `replaceAll('](assets/', '](../assets/')` on the entire file, which also rewrote matching text inside fenced code blocks. A new `rewriteAssetLinks` helper processes the file line-by-line and skips any line inside a fence.

**Task date inputs showed today's date for intentionally blank fields**
When a task had no start, due, or completed date, the date input fell back to today, misleading at a glance. Blank fields now remain blank in the input.

#### Low

**Local variable `isNew` shadowed the module-level `isNew` flag**
Inside `loadSqliteDb`, a local `const isNew` shadowed the outer `isNew` state used to track whether the editor holds a new unsaved note. Renamed to `isEmptyDb` to eliminate the ambiguity.

**`isCurrentTaskFile()` returned false for archived task files**
The check `currentPath.split('/')[1] === 'tasks'` failed for paths like `personal/tasks/archived/foo.md`. Replaced with `parts.includes('tasks')` to handle any nesting depth.

**Old blob URL not revoked when the same asset filename was pasted again**
`assetBlobUrls.set(key, newUrl)` silently overwrote the old entry without revoking it, leaking one blob URL per overwrite. The old URL is now revoked before the new one is stored.

**Calendar did not refresh when task data changed while the view was open**
`buildCalTaskMap()` was only called when the calendar was first opened. Moves, archives, deletes, and saves that happened while the calendar was already visible left it showing stale dates. A `refreshCalendarIfVisible()` helper is now called after every task-modifying operation.

---

### Files Added / Changed

| File | Change |
|---|---|
| `Apps/recallstack.html` | Auto-save, dependency status bar, SQLite web/local toggle, root pseudo-folder, root move destination, library loading, highlight.js full-language, What's New modal, new note guard, app rename |
| `Apps/lib/sql-wasm.js` | New — local fallback |
| `Apps/lib/sql-wasm.wasm` | New — local fallback |
| `Apps/lib/marked.min.js` | New — local fallback |
| `Apps/lib/highlight.min.js` | New — local fallback (common 36 languages) |
| `Apps/lib/highlight.full.min.js` | New — local fallback (all 192 languages) |
| `Apps/lib/mermaid.min.js` | New — local fallback |
| `Apps/lib/update-libs.sh` | New — re-download and rebuild all local library copies |
| `Apps/changes.md` | New — this file |
| `Apps/readme.md` | Updated — auto-save docs, library status bar, SQLite source toggle, root navigation, move/archive notes, keyboard shortcuts |

---

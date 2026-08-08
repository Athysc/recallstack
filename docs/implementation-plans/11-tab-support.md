# Improvement 11 Implementation Plan: Multi-File Tabs

**Status:** Proposed — analysis only, no implementation yet (2026-08-07)
**Recommended execution point:** After the CodeMirror editor and command-palette work (both already implemented) — tabs build directly on `MarkdownEditorAdapter.openDocument()` and the `CommandRegistry`.
**Primary outcome:** Let a user open several notes at once and switch between them instantly, each remembering its own content, cursor, scroll position, undo history, and dirty state — without regressing the app's existing save/draft/watcher/task-header behavior.

## Current Baseline

RecallStack's editor is built around a **single open document**, not a document list:

- One global CodeMirror `EditorView` (`mdEditor`, created once in `recallstack-runtime.ts`).
- One global preview DOM node (`#preview-output`, rendered by `setPreviewMarkdown()`).
- One set of module-level `let` variables describing "the currently open file": `currentPath`, `savedContent`, `isNew`, `isOutputsFile`, `currentOutputsFh`, `currentOutputsDirFh`, `currentBacklinks`, plus task-specific derived UI state (date bar, priority/status pickers, `#task-kind-indicator`).
- `currentPath` alone is referenced **88 times** across the 7,700-line controller.
- Roughly 20+ navigation entry points (sidebar clicks, search results, quick-open, task lists, calendar/journal, internal links) guard themselves with `checkUnsavedNewNote()` + `autoSaveIfDirty()` before replacing `currentPath` with a new file — the app already has a coherent "leaving a document" lifecycle, it's just wired to a single slot.

Some pieces are already usefully **path-keyed**, which reduces tab-feature risk:

- `MarkdownEditorAdapter.openDocument(key, text, cursor)` (`src/features/editor/markdown-editor.ts`) already swaps CodeMirror's document and restores `{anchor, head, scrollTop}` from a `localStorage`-backed map keyed by document path — this is effectively a primitive form of tab-switching already built. It does **not** currently preserve undo/redo history (`setText()` dispatches with `Transaction.addToHistory.of(false)`).
- Draft autosave/recovery (`saveDraft`/`loadDraft`/`clearDraft`) is already workspace-and-path scoped.
- `nativeFileVersions` (conflict-safe native writes) is already a `Map` keyed by path.
- `assetBlobUrls` (image/asset blob cache) is already a shared `Map` keyed by relative path — fine to keep global under a tabs model.
- No existing `Ctrl+Tab` / `Ctrl+W` bindings — both are free for tab navigation/closing.

DOM structure (`index.html`): `#editor-toolbar` → `#task-date-bar` → `#split-pane` (`#editor-pane` hosting `#md-editor`, `#preview-pane` hosting `#preview-output`). A tab strip fits naturally between the toolbar and the split pane, so it visually "owns" both the editor and preview panes below it — matching the requested "each tab has its own editor + preview" feel.

## Two Implementation Strategies

### Option A — Shared editor/preview, virtual tabs (recommended)

Keep **one** CodeMirror instance and **one** preview DOM. A tab is a lightweight record: `{id, path, title, isNew, dirty}`. Switching tabs = swap CodeMirror's document + re-render preview, the same operation that already happens today when opening a different file. This reuses the vast majority of existing code (save, drafts, watcher, task header/date bar, backlinks) largely unchanged — those pieces just need to read/write through "the active tab" instead of bare module-level globals.

Upgrade over the current document-swap: store a real `EditorState` per tab (cheap, plain-object-ish in CodeMirror 6) and switch via `view.setState(tabState)` instead of `setText()`. This preserves full undo/redo history per tab essentially for free, with no second `EditorView` needed. Pair it with caching each tab's last-rendered preview HTML and swapping `previewOut.innerHTML` directly (re-attaching mermaid/copy-button/collapsible-heading listeners afterward) instead of re-parsing Markdown on every switch.

- **Pros:** small risk, small diff, low memory (one CodeMirror view, one preview DOM, N lightweight `EditorState` objects), ships fast, and — with the `EditorState`/preview-HTML caching above — is very close to indistinguishable from "real" tabs by feel.
- **Cons:** no simultaneous split-view of two tabs; a future split-editor feature would eventually need Option B anyway.

### Option B — Fully independent editor + preview per tab

Every open tab keeps its own live `EditorView` and preview DOM mounted in the tree (inactive ones `display:none`) — true multi-instance editing, like browser tabs or VS Code split editors.

- **Pros:** enables future split-view / side-by-side comparison; no shared-instance edge cases at all.
- **Cons:** every singleton listed in "Current Baseline" (`currentPath`, `savedContent`, `isNew`, `isOutputsFile`, the two outputs handles, `currentBacklinks`, task-meta-driven UI, the external-change-conflict banner, etc.) has to become per-tab state, and all ~88 `currentPath` references plus the 20+ unsaved-changes guard sites need individual auditing. DOM/memory cost scales linearly with open tab count (CodeMirror + syntax highlighting + mermaid rendering is not free per instance). This is realistically a multi-week refactor of a single very large controller file, not a quick feature.

### Recommendation

Ship **Option A**. It delivers the requested behavior — open multiple files, switch instantly, each with correct content/cursor/scroll/undo — for a fraction of the risk and effort of Option B, and doesn't foreclose Option B later if true split-view is ever wanted.

## Design Decisions (for Option A)

- Tab model: `{id, path: string | null, title, isNew, dirty, editorState, previewHtml, previewScrollTop}`. `path === null` marks an unsaved "Untitled" tab, mirroring today's `isNew` flow.
- One `activeTabId`. Existing single-document module state either moves onto the tab record or gets recomputed from it on activation — this migration *is* the real engineering work, not new product logic.
- Opening a file already open in some tab activates that tab rather than duplicating it (standard tab behavior).
- Every "open a file" entry point funnels through one `openFileInTab(path)`: sidebar clicks, search results, quick-open (`Ctrl+P`), `#recallstack-open=` internal links, task list / All Tasks / Working Tasks clicks, calendar/journal open, backlinks panel.
- Closing a dirty tab reuses the existing unsaved-changes flow (`checkUnsavedNewNote` / `autoSaveIfDirty`), scoped to that tab instead of "the app."
- Switching workspaces extends the existing single-file unsaved-changes check into a loop over all open tabs.
- Session persistence (open tabs, order, active tab, per-tab scroll/cursor) saved per-workspace in `localStorage`, following the existing `PREFERENCE_KEYS` / `workspacePreferenceKey` convention — optional for v1 but cheap to add given the existing pattern.
- New shortcuts: `Ctrl+Tab` / `Ctrl+Shift+Tab` (next/previous tab), `Ctrl+W` (close active tab), `Ctrl+1`–`9` (jump to tab N).
- New command-palette entries: Close Tab, Close Other Tabs, Reopen Closed Tab, Next Tab, Previous Tab — registered through the existing `CommandRegistry`, consistent with how all other actions are wired.

## UI Sketch

A tab strip inserted between `#editor-toolbar` and `#task-date-bar`/`#split-pane`. Each tab shows the file title, a dirty indicator when unsaved, a close (×) control, and a distinct active-tab style. Many-tabs overflow needs a scroll or overflow-menu treatment — worth reusing the existing combo-mode overflow pattern already used for the nav rows rather than inventing a new one.

## Implementation Phases

### Phase 1 — Tab bar + shared editor/preview (Option A core)
1. Introduce the tab-record model and `activeTabId`.
2. Add `openFileInTab()` and route every existing "open file" call site through it.
3. Build the tab-strip UI (open/close/activate) in `index.html` + new CSS under `src/ui/styles/`.
4. Wire close/dirty handling through the existing `checkUnsavedNewNote`/`autoSaveIfDirty`, scoped per tab.
5. Migrate the ~88 `currentPath` references and the other singleton file-state variables to read/write through the active tab record.

### Phase 2 — Full per-tab editor state
1. Store a real CodeMirror `EditorState` per tab; swap with `view.setState()` instead of `setText()` to preserve undo/redo.
2. Cache each tab's last-rendered preview HTML; swap `innerHTML` on activate and only re-parse Markdown when that tab's content changed since its last render.
3. Make mermaid rendering, collapsible headings, and code-copy-button wiring idempotent/re-invocable per activation (today they bind once per render pass).

### Phase 3 — Session persistence
1. Persist open tabs (paths, order, active tab) per workspace in `localStorage`.
2. Restore tabs on workspace open; skip and report any tab whose file no longer exists on disk.

### Phase 4 — Polish (optional/later)
1. Drag-to-reorder tabs.
2. Pin tab (exempt from any future auto-close/eviction policy).
3. Split view (two tab groups side by side) — this is effectively Option B scoped to just the split tabs; treat as a separate, later proposal rather than folding it into this one.

## Risks and Controls

- **Silent slide into Option B.** Hard rule for Phase 1: only one `EditorView` and one preview DOM node may exist at a time. Any code creating a second live `EditorView` is out of scope.
- **The `currentPath` migration is the real cost, not the tab UI.** Budget most of Phase 1 there; the tab strip itself is a small, isolated component.
- **File watcher / external-change banner** currently assumes a single open file; needs to become tab-aware — at minimum, actively check the active tab and defer external-change checks for background tabs until they're activated.
- **Task-specific chrome** (`#task-date-bar`, priority/status pickers, `#task-kind-indicator`) is currently derived once per file open; it must be re-evaluated on every tab switch.
- **Mermaid re-render cost** on every switch if not cached — mitigated by the Phase 2 preview-HTML cache.
- **Memory growth with many tabs open** — bounded by keeping only lightweight `EditorState` objects (not full `EditorView`s) for background tabs. If this proves to matter in practice, add an optional LRU cap that discards cached `EditorState`/preview HTML for the least-recently-used background tabs (re-deriving from disk on reactivation) while keeping the tab entry itself.

## Out of Scope (this proposal)

- Split-view / multiple simultaneously visible panes.
- Cross-window / multi-monitor tab tear-off.
- Tab groups or tab search.
- Sharing tabs across different open workspaces (tabs stay workspace-scoped, matching the rest of the app's per-workspace model).

## Completion Criteria (Phases 1–2)

- Opening N files creates N tabs; clicking a tab shows that file's exact content, cursor, scroll position, and undo history instantly.
- Existing single-file behaviors (save, autosave draft recovery, external-change conflict banner, task header/date bar, backlinks, Working Tasks pane) continue to work per active tab with no regression.
- Closing a dirty tab prompts exactly like today's single-file unsaved-changes flow, scoped to that tab.
- No second CodeMirror `EditorView` or second preview render pipeline is introduced.

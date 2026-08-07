# Improvement 9 Implementation Plan: CodeMirror 6 Markdown Editor

**Status:** Implemented and verified (2026-08-06)
**Recommended execution point:** After modularization, native file versioning, and conflict handling  
**Primary outcome:** Replace the textarea editor with CodeMirror 6 while retaining Markdown-native files, current preview behavior, task metadata controls, and keyboard expectations.

## Implemented Scope

- The textarea editing surface is replaced by an application-owned CodeMirror 6 adapter; legacy feature code uses the adapter contract rather than CodeMirror internals.
- Markdown syntax highlighting, folding, bracket matching, local search/replace, history, multiple/rectangular selection, active-line highlighting, and theme-token styling are enabled.
- Persistent word-wrap and line-number controls, two-space/list keyboard behavior, command-registry save and insertion actions, and task metadata controls remain intact.
- Existing image paste/drop, asset persistence, preview rendering, crash drafts, version-token conflict UI, and expected-version saves continue through their native safety-aware paths.
- `[[` note and `#` tag completion are driven by the workspace index; document cursor, selection, and scroll state persist for the most recent 100 documents.
- Documents above 1 MiB disable costly Markdown language extensions, and large-note preview work receives a longer debounce without affecting immediate dirty/draft tracking.
- Unit coverage verifies selection restoration bounds and the large-file degradation threshold; the full frontend parity/type/production-build suite passes.

## Current Baseline

The running original interface edits Markdown in a textarea and synchronizes it with preview, task controls, paste/drop handlers, cursor restoration, word wrapping, presentation mode, and save logic. CodeMirror dependencies and an editor wrapper exist from the unused replacement frontend, but they are not integrated and should not be treated as completed work.

## Design Decisions

- Markdown remains the only saved representation.
- CodeMirror is a source editor, not a WYSIWYG layer.
- Preview remains a separate rendered pane.
- Existing filename-based task metadata remains supported.
- Vim mode is optional and off by default.
- Editor state is per open note and must not leak across workspaces.

## Required Capabilities

- Markdown syntax highlighting.
- Line numbers toggle.
- Search and replace within the current file.
- Folding, bracket matching, history, multiple selections, and rectangular selection where supported.
- Word wrapping toggle.
- Drag/drop and paste of images/assets.
- Markdown-aware list continuation and indentation.
- Internal-link and tag completion.
- Cursor, selection, fold, and scroll restoration.
- Large-file degradation strategy.
- Current editor/preview scroll synchronization or a documented improved replacement.

## Implementation Phases

### Phase 1: Editor adapter and lifecycle

Define an application-owned adapter instead of exposing CodeMirror throughout features:

```ts
interface MarkdownEditorAdapter {
  open(document: EditorDocument): void;
  getText(): string;
  setText(text: string, preserveHistory?: boolean): void;
  focus(): void;
  getSelection(): TextSelection;
  insertText(text: string): void;
  onChange(listener: (change: EditorChange) => void): Unsubscribe;
  destroy(): void;
}
```

Create/destroy the view explicitly when application panes change. Keep save, dirty-state, and file-version logic outside CodeMirror.

### Phase 2: Parity configuration

1. Configure Markdown language support and existing RecallStack theme tokens.
2. Implement wrapping, tab size, indentation, line-number preference, and cursor behavior.
3. Route `Ctrl+S` to the shared Save command.
4. Integrate undo/redo without accidentally undoing programmatic file reloads.
5. Reimplement copy Markdown/HTML/path/internal-link actions through the command registry.
6. Maintain task metadata controls outside the editor document.

### Phase 3: Paste, drop, and assets

1. Intercept image clipboard and drag/drop events.
2. Save assets through native safety-aware commands.
3. Insert relative Markdown links at the selection.
4. Show progress and failures without losing clipboard content.
5. Revoke preview object URLs and handle externally changed assets.

### Phase 4: Markdown intelligence

1. Continue lists and task checkboxes on Enter.
2. Add link completion from native search index.
3. Add tag completion and heading outline.
4. Add commands for links, fenced code, Mermaid, tables, and task checkboxes.
5. Keep parsing extensions isolated so they can be tested.

### Phase 5: File state and conflicts

1. Associate each open document with the native version token returned on read.
2. Save with an expected-version precondition.
3. Display the external-change conflict UI supplied by filesystem watching.
4. Persist crash-recovery drafts outside the workspace.
5. Preserve cursor and scroll on safe external reload.

### Phase 6: Performance and large files

1. Profile startup, typing latency, preview refresh, and very large notes.
2. Debounce preview rendering independently from dirty-state tracking.
3. Move expensive Mermaid and syntax rendering off the immediate typing path.
4. Disable costly extensions above configurable size thresholds.
5. Avoid recreating the editor for ordinary saves or preference changes.

### Phase 7: Optional Vim mode

1. Add a workspace/user preference.
2. Load the Vim extension lazily.
3. Document conflicts with application shortcuts.
4. Ensure the user can always exit Vim mode through settings or command palette.

## Testing Strategy

- Unit tests for editor adapter, insertion commands, list continuation, and preferences.
- Integration tests for open/edit/save/reload/undo and dirty-state transitions.
- Paste/drop asset tests with collisions and failures.
- Conflict tests using watcher-driven external edits.
- Performance tests for 10 KB, 1 MB, and larger Markdown documents.
- Manual IME, accessibility, clipboard, and Linux/Windows keyboard tests.

## Completion Criteria

- Existing note and task editing workflows work with CodeMirror.
- Save and conflict behavior is version-safe.
- Markdown preview and asset paste/drop remain functional.
- Typing stays responsive on normal notes and degrades gracefully on large notes.
- Cursor/scroll preferences survive reopening.
- The textarea implementation and unused editor wrapper are removed.

## Risks and Controls

- **Feature parity gaps:** inventory every textarea event listener before replacement.
- **Shortcut conflicts:** use the shared command/shortcut dispatcher.
- **Preview lag:** debounce and isolate expensive rendering.
- **Data loss:** native version tokens, drafts, and atomic writes are prerequisites.
- **Bundle size:** import only required CodeMirror extensions and lazy-load optional modes.

## Out of Scope

- WYSIWYG or rich-text editing.
- Real-time collaboration.
- Embedded execution of code blocks.

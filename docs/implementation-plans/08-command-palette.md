# Improvement 8 Implementation Plan: Command Palette

**Status:** Planned  
**Recommended execution point:** After frontend modularization provides stable feature commands  
**Primary outcome:** Provide one keyboard-first interface for discovering and executing application actions without duplicating business logic.

## Current Baseline

The earlier replacement frontend contained a small command overlay, but that frontend is not the running application. The original interface has many button handlers and keyboard actions but no shared command registry. Implementing only a visual palette would create a second set of action logic and inconsistent enablement.

## Design Decisions

- Default shortcut: `Ctrl+K`, with `Ctrl+P` optionally opening a note-focused mode.
- Commands are registered objects, not palette-specific callbacks.
- Toolbar buttons, menus, keyboard shortcuts, and the palette invoke the same command handlers.
- Commands expose availability and reason-for-disable based on current state.
- The first release is local and deterministic; no AI command interpretation.

## Command Contract

```ts
interface AppCommand {
  id: string;
  title: string;
  category: "File" | "Navigation" | "Editor" | "Tasks" | "View" | "Tools" | "Workspace";
  keywords?: string[];
  shortcut?: string;
  icon?: string;
  isVisible(state: AppState): boolean;
  isEnabled(state: AppState): boolean;
  disabledReason?(state: AppState): string;
  run(context: CommandContext, argument?: unknown): Promise<void> | void;
}
```

IDs must be stable because shortcuts, user customization, telemetry-free usage history, and future plugins may refer to them.

## Initial Command Set

- Open/Switch Workspace.
- Open Recent Workspace.
- Create Note.
- Open Note.
- Save Note.
- Move/Rename/Archive/Trash Note.
- Search Notes and Search Tasks.
- Jump to Today.
- Toggle Preview and Presentation Mode.
- Insert Markdown Link, Code Block, and Mermaid Block.
- Change Theme.
- Rebuild Search Index.
- Validate Workspace.
- Find Broken Links and Orphan Assets.
- Backup Workspace.
- Reveal Current File/Workspace.
- Show Git Status.
- Close RecallStack.

## Implementation Phases

### Phase 1: Command registry

1. Add a typed registry service supporting registration, lookup, listing, and execution.
2. Move existing toolbar and shortcut actions behind commands feature by feature.
3. Add command context containing current app state and typed services.
4. Ensure execution errors go through one error-reporting path.
5. Prevent simultaneous execution of commands marked non-reentrant.

### Phase 2: Palette shell

1. Add an accessible modal/overlay matching RecallStack themes.
2. Focus the query input on open and restore previous focus on close.
3. Support arrow keys, Page Up/Down, Enter, Escape, and mouse selection.
4. Show category, shortcut, icon, disabled state, and disabled explanation.
5. Trap focus while open and expose correct ARIA combobox/listbox semantics.

### Phase 3: Ranking and modes

1. Implement deterministic fuzzy matching across title, category, and keywords.
2. Rank prefix and word-boundary matches above substring matches.
3. Add optional modes such as `>` for commands, `@` for notes, `#` for tags, and `?` for help.
4. Store a small local recency/frequency score, scoped to the user and never uploaded.
5. Cap rendering and virtualize only if profiling shows it is necessary.

### Phase 4: Argument flows

Some commands require a second selection or input:

- Switch workspace → recent/pinned workspace.
- Open note → indexed notes.
- Move note → destination folder.
- Change theme → theme list.
- Insert internal link → target note.

Implement these as explicit palette states with Back/Escape behavior rather than opening unrelated prompts.

### Phase 5: Shortcut unification

1. Create a shortcut dispatcher mapping keystrokes to command IDs.
2. Respect editor-specific shortcuts and composition/input states.
3. Display platform-appropriate labels.
4. Add conflict detection before introducing customization.
5. Keep critical browser/WebView/system shortcuts untouched.

## Testing Strategy

- Unit tests for registry behavior, fuzzy ranking, availability, and shortcut conflicts.
- DOM tests for focus trap, keyboard navigation, disabled commands, and argument states.
- Integration tests proving toolbar and palette invoke the same handler.
- Theme and narrow-window visual tests.
- Screen-reader and keyboard-only manual checks.

## Completion Criteria

- `Ctrl+K` opens the palette from all normal application views.
- Initial commands are discoverable and execute through shared command handlers.
- Disabled actions explain why they cannot run.
- Palette operation requires no mouse and meets accessibility expectations.
- No command duplicates filesystem or feature business logic.
- Errors and long-running progress are displayed consistently.

## Risks and Controls

- **Duplicated actions:** migrate existing controls to registry-backed commands first.
- **Shortcut conflicts:** central dispatcher and editor-aware routing.
- **Overloaded palette:** categories and explicit argument modes.
- **Stale availability:** derive it from current typed application state.

## Out of Scope

- Third-party command plugins.
- Natural-language command execution.
- Macro recording.

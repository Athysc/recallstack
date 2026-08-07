# Improvement 4 Implementation Plan: Modularize the Monolithic Frontend

**Status:** Implemented 2026-08-06, with the preserved controller isolated as documented migration debt
**Recommended execution point:** After the native performance milestone  
**Primary outcome:** Preserve the established RecallStack interface while moving its CSS, markup, state, services, and feature logic out of `recallstack.html` into testable TypeScript modules.

## Current Baseline

The running desktop application loads `recallstack.html`, which contains roughly 9,000 lines of CSS, markup, and JavaScript. The separate files currently under `src/` belong to an earlier replacement interface and are not the production frontend. The desktop filesystem compatibility layer lives in `desktop-shim.js` and should be retired as feature code moves to explicit native service calls.

This improvement is structural. It must not redesign the UI, change workspace conventions, or alter note/task behavior.

## Implemented Result

- `index.html` is the production shell and `src/main.ts` is the only Vite entry point. `recallstack.html` is retained solely as a byte-parity fixture and is not loaded or bundled.
- The original DOM and CSS are checked byte-for-byte by `npm run test:frontend:parity`; selectors and layout were not redesigned.
- CSS is split into eleven responsibility-based modules under `src/ui/styles/`.
- Bootstrap, capability detection, preferences, event contracts, high-level state, task filename parsing, theme validation, and the Tauri bridge are TypeScript modules.
- The former `desktop-shim.js`, its public copy, and the unused replacement frontend were removed from production.
- Pure frontend behavior has Node unit tests; `npm run verify:frontend` runs tests, parity checks, TypeScript checking, and the production build.
- The behavior-dense controller is temporarily isolated in `src/app/recallstack-runtime.ts`. It exceeds the normal file-size guideline because mechanically splitting its closure-scoped state would create more regression risk than retaining it behind the new typed boundaries. New behavior must not be added there when it can live in a typed feature/service module; improvements 5 and later use those boundaries. Its removal criterion is complete vertical extraction of its remaining editor, navigation, calendar, outputs, assets, and search controllers with equivalent smoke coverage.

## Prerequisites

- Complete the performance milestone in `performance-native-data-layer.md`.
- Freeze a manual regression checklist for the current original interface.
- Capture reference screenshots for welcome, file list, note editor, tasks, calendar, outputs, modals, and every shipped theme.
- Establish stable TypeScript contracts for workspace, filesystem, search, tasks, and watcher events.

## Target Structure

```text
src/
  app/
    bootstrap.ts
    state.ts
    events.ts
    preferences.ts
  features/
    assets/
    calendar/
    notes/
    outputs/
    search/
    tasks/
    themes/
    workspaces/
  services/
    native.ts
    workspace.ts
    filesystem.ts
    search.ts
    settings.ts
    watcher.ts
  ui/
    components/
    modals/
    panes/
    styles/
  main.ts
src-tauri/
  src/commands/
```

Use plain TypeScript and DOM APIs during this migration. Introducing React, Vue, Svelte, or another component framework would combine a framework rewrite with a modularization and materially increase regression risk.

## Implementation Phases

### Phase 1: Establish the production TypeScript entry point

1. Replace the redirect-based `index.html` with the real application shell.
2. Create `src/main.ts` as the only frontend entry point.
3. Move startup, dependency initialization, global error handling, and desktop/browser capability detection into `src/app/bootstrap.ts`.
4. Keep the generated DOM and class names identical to the original so existing styles remain valid.
5. Remove the unused replacement interface only after the original interface is running through the new entry point.

### Phase 2: Extract CSS without visual changes

Split the original `<style>` block by responsibility:

- `tokens.css`: themes, colors, spacing, typography.
- `shell.css`: welcome screen, header, navigation, pane layout.
- `files.css`: file cards, task groups, counts, sort controls.
- `editor.css`: toolbar, split pane, Markdown preview, presentation mode.
- `calendar.css`, `modals.css`, `assets.css`, and `utilities.css`.

Run screenshot comparison after each extraction. Do not rename selectors during this phase.

### Phase 3: Centralize state and preferences

1. Define a typed `AppState` containing workspace, navigation, editor, task, output, search, and presentation state.
2. Move local-storage keys and default values into `preferences.ts`.
3. Replace scattered mutable globals with explicit state mutations.
4. Introduce a small event dispatcher for state changes; avoid a large state-management dependency.
5. Document which state is global, workspace-scoped, and session-only.

### Phase 4: Extract low-risk services

Extract pure or mostly pure functionality first:

- Filename and task metadata parsing.
- Markdown rendering configuration.
- Theme selection and persistence.
- Date and calendar calculations.
- Sorting, grouping, and filtering.
- Clipboard formatting and internal-link generation.

Add unit tests before changing callers.

### Phase 5: Extract features vertically

Move one complete feature at a time in this order:

1. Themes and preferences.
2. Workspace switching and navigation.
3. Notes and file lists.
4. Editor and preview.
5. Tasks and working-task panes.
6. Calendar.
7. Outputs and assets.
8. Search.

Each feature owns its DOM binding, rendering, events, and calls to typed services. Cross-feature behavior must go through explicit interfaces rather than importing another feature’s internal state.

### Phase 6: Remove compatibility code

1. Replace remaining `FileSystemDirectoryHandle` emulation calls with typed native services.
2. Remove `desktop-shim.js` and its public copy.
3. Remove browser-only IndexedDB handle persistence from the desktop path.
4. Remove duplicate and unused files from the earlier replacement frontend.
5. Retain an optional browser adapter only if browser delivery remains a supported product.

## Testing Strategy

- Unit tests for pure parsers, grouping, sorting, preference migration, and date logic.
- DOM tests for each feature’s render and event behavior.
- Rust integration tests for native service contracts.
- End-to-end smoke tests: open workspace, navigate folders, open/edit/save note, manage task, use calendar, inspect output, and switch theme.
- Screenshot baselines at 900×620, 1280×800, and a wide desktop size.
- Manual test against the real `/home/scdev/notes` structure using a read-only copy or dedicated test workspace.

## Completion Criteria

- `recallstack.html` is no longer the production implementation.
- No production TypeScript file exceeds an agreed guideline of approximately 500 lines without justification.
- Original visual layout and keyboard behavior remain intact.
- Browser handle emulation is absent from the desktop runtime.
- The full build, unit tests, end-to-end smoke tests, and visual regression checklist pass.
- No workspace file format or directory layout migration is required.

The file-size criterion currently has the explicit transitional exception described above; every other criterion is enforced by the phase-4 verification command or by retaining the original markup and workspace contracts.

## Risks and Controls

- **Visual drift:** preserve markup/classes first and use screenshots.
- **Hidden global dependencies:** extract in small vertical slices and type every shared contract.
- **Behavior regressions:** retain feature-specific manual checklists until automated coverage exists.
- **Permanent dual architecture:** assign a removal criterion to every compatibility module.

## Out of Scope

- A new visual design.
- A rich-text/WYSIWYG editor.
- Graph view or semantic/AI search.
- Changing Markdown or task filename formats.

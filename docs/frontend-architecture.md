# RecallStack Frontend Architecture

## Production entry and legacy reference

The desktop application loads `index.html`, which imports `src/main.ts`. Startup installs the Tauri bridge, configures bundled Markdown/highlight dependencies, detects capabilities, and then starts the application controller.

`recallstack.html` is not a runtime input. It is kept as a read-only visual/behavior reference while modularization continues. `scripts/verify-frontend-parity.mjs` proves that the production DOM and the ordered modular styles still match that reference. It can be removed after screenshot and end-to-end coverage replace this parity fixture.

## Module boundaries

- `src/app/`: bootstrap, shared state/event contracts, preference keys, and the transitional controller.
- `src/features/`: feature-owned pure logic and, as migration continues, DOM controllers.
- `src/services/`: native/Tauri integration. Feature code should use typed services rather than raw `invoke` calls.
- `src/ui/styles/`: ordered responsibility-based CSS with unchanged selectors.
- `src/main.ts`: composition only; it must not contain feature behavior.

The controller in `src/app/recallstack-runtime.ts` preserves the original interface and behavior while vertical feature slices are extracted. It is deliberately marked `@ts-nocheck`; this exception does not extend to new modules. New watcher, packaging, theme, task, and preference behavior belongs in typed modules.

## State ownership

Global state includes the active workspace identity, current navigation, open editor document, search generation, and presentation state. Workspace-scoped persisted preferences use `workspacePreferenceKey`. Global persisted preferences use keys from `PREFERENCE_KEYS`. Drafts are workspace-and-path scoped through `draftPreferenceKey`. Transient DOM state remains inside its feature controller and must not be persisted accidentally.

## Verification

Run:

```bash
npm run verify:frontend
```

This validates pure TypeScript behavior, exact reference DOM/CSS parity, TypeScript compilation, dependency synchronization, and the optimized Vite build. Native contract tests are run separately with `cargo test --manifest-path src-tauri/Cargo.toml`.

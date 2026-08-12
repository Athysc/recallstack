# RecallStack Frontend Architecture

## Production entry

The desktop application loads `index.html`, which imports `src/main.ts`.
Startup installs the Tauri workspace services, configures bundled Markdown and
highlighting dependencies, installs native watcher events, and starts the
application controller. There is no browser delivery target or alternate HTML
implementation.

Production behavior is protected by unit tests, native end-to-end coverage, and
Linux screenshot baselines. `npm run verify:frontend` runs unit tests, strict
TypeScript compilation, dependency synchronization, the optimized Vite build,
and end-to-end tests when a suitable display is available.

## Module boundaries

- `src/app/`: bootstrap, shared state contracts, preference keys, and application composition.
- `src/features/`: feature-owned logic and DOM renderers for navigation, notes, tasks, tabs, search, themes, calendar, assets, and outputs.
- `src/services/`: native/Tauri integration, filesystem operations, Markdown services, watcher events, and native progress adapters.
- `src/ui/components/`: reusable modal and document UI behavior.
- `src/ui/styles/`: ordered responsibility-based CSS.
- `src/main.ts`: startup composition only.

`src/app/recallstack-runtime.ts` is the typed application composition controller
for live cross-feature DOM and workspace state. It and every production module
under `src/` are covered by the strict TypeScript build. File- or line-level
TypeScript suppressions are prohibited by a frontend regression test.

The controller deliberately retains application-level coordination while
feature logic, rendering, and native access live behind the typed boundaries
above. Further extraction should be driven by ownership or measured performance,
not treated as unfinished migration work.

## Native data boundary

RecallStack is desktop-only. Rust SQLite is the sole search index, and recent
workspace paths are persisted by the native application. The handle-shaped
objects in `desktop-bridge.ts` are an internal facade over validated Rust
filesystem commands; they do not provide browser File System Access or
IndexedDB persistence.

## State ownership

Global state includes active workspace identity, current navigation, the open
editor document, open tabs, search generation, and presentation state.
Workspace-scoped preferences use workspace-qualified keys. Drafts are scoped by
workspace and path. Transient DOM state remains inside its owning controller and
must not be persisted accidentally.

## Verification

Run:

```bash
npm run verify:frontend
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

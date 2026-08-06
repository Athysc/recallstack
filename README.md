# RecallStack Desktop

The Tauri 2 desktop port of RecallStack. Markdown files under `Data/` remain canonical. `DB/index.db` is a native SQLite FTS5 index that can always be rebuilt.

## Development

```bash
npm install
npm run tauri:dev
```

## Portable Windows executable

RecallStack intentionally does **not** create an MSI or setup installer. Build the standalone executable with:

```bash
npm run tauri:build:windows
```

The result is `src-tauri/target/x86_64-pc-windows-msvc/release/recallstack.exe`. It can be copied and run directly; workspace data stays in the selected workspace and app settings/recent-workspace list live in the user app-data directory.

For a native Linux development build, run `npm run tauri:build`; its executable is `src-tauri/target/release/recallstack`.

## Desktop architecture

The desktop build runs the established `recallstack.html` interface directly. A Tauri compatibility layer implements its browser File System Access handles with native Rust commands, so the existing notes, tasks, calendar, assets, outputs, themes, and navigation remain available without redesigning the application. Markdown remains canonical in the selected workspace.

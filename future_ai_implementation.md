# Future AI Implementation — Embedded AI CLI Panel

> Status: **design notes only, not started**
> Drafted: 2026-08-29
> Scope: add the ability to launch / interact with an already-installed AI coding CLI
> (Claude Code, Codex, or any other) from inside recallstack while editing a Markdown
> file, with the CLI running in that file's folder and aware of the selected file.

---

## 1. Goal

When the user is on a Markdown file in recallstack, they can open a panel that runs
their chosen AI CLI:

- launched with its working directory set to the **folder containing the current file**
- seeded with an **initial prompt that references the selected file** (and optionally
  cursor position / selection)
- rendered as a real interactive terminal inside the app (the CLI's own TUI)

recallstack must **never install, bundle, or manage** the AI CLIs. The user brings
their own. recallstack is a host/launcher only.

---

## 2. Approaches considered

| # | Approach | Effort | UX | Verdict |
|---|----------|--------|----|---------|
| 1 | Launch an **external terminal** (`alacritty -e claude …`) in the file's dir | ~1 evening | separate window | Good for a quick prototype / validation |
| 2 | **Embedded terminal**: PTY (`portable-pty`) + `xterm.js` panel | Few days | native, docked | **Chosen approach** |
| 3 | **Custom chat UI** via headless mode (`claude -p --output-format stream-json`) or the Claude Agent SDK sidecar | Medium–High | bespoke, on-brand | Only if we want our own chat UI instead of the CLI's TUI; adds a sidecar to maintain |

Plan: optionally prototype with #1 to prove out the workflow and context injection,
then build #2 as the real feature.

---

## 3. Design principle — Bring Your Own CLI (BYO-CLI)

- recallstack ships **nothing**. No sidecar binary, no installer logic, no Node runtime.
- A **master on/off switch** in settings controls whether the feature exists at all.
- A **profile list** lets the user register one or more CLIs they already have installed
  and pick the active one.
- If the feature is disabled or no profile is selected, the panel and its Tauri
  command are not registered / not rendered — no AI code path runs.
- Auto-detection of installed CLIs is a **convenience for populating a profile**, never
  a dependency. A fully hand-typed absolute path must work with zero detection.

### 3.1 Preferences model

Extend `src/app/preferences.ts`:

```ts
aiCli: {
  enabled: boolean,               // master switch; false => panel + command not registered
  activeProfileId: string | null,
  profiles: Array<{
    id: string,
    label: string,                // "Claude Code", "Codex", "my aider wrapper"
    command: string,              // absolute path OR bare name to resolve on PATH
    args: string[],               // static extra args, e.g. ["--permission-mode","plan"]
    promptTemplate: string,       // e.g. "Look at @{{relFile}} — "
    env: Record<string, string>,  // optional env overrides for the child
  }>,
}
```

Template variables available to `promptTemplate` (resolved at launch):

| Token | Meaning |
|-------|---------|
| `{{relFile}}`  | file path relative to the launch cwd (the file's folder) — usually just the filename |
| `{{absFile}}`  | absolute path to the file |
| `{{fileName}}` | basename only |
| `{{dir}}`      | the launch cwd (file's folder) |
| `{{line}}`     | 1-based cursor line, if available |
| `{{selection}}`| selected text, if any (consider length-capping) |

### 3.2 Backend behavior rules

- `enabled === false` **or** `activeProfileId === null` → do not register the launch
  command; frontend hides the panel entry point.
- Command resolution order:
  1. If `command` is an absolute path → use as-is.
  2. Else resolve against `PATH` at spawn time (`which` / `where`), **and** check common
     locations: npm global bin (`%APPDATA%\npm`, `$(npm root -g)/../bin`),
     `~/.local/bin`, cargo bin (`~/.cargo/bin`), Homebrew (`/opt/homebrew/bin`,
     `/usr/local/bin`), Scoop shims (`~/scoop/shims`).
  3. Unresolved → structured error surfaced in the UI:
     *"'claude' not found — check the path in Settings."* Never a raw stack trace.
- Resolve to an absolute path **once per terminal session** and cache it; do not
  re-resolve per keystroke.
- **Validate on save**: run `<command> --version` (short timeout, plain pipe, no PTY)
  and show ✓ + version string or ✗ in Settings. Catches PATH problems before a panel
  is ever opened.

### 3.3 Detection command (optional convenience)

`detect_ai_clis` (backend): probe a known list — `claude`, `codex`, `gemini`, `aider`,
etc. — via `which`/`where` plus the common dirs above; return `{ name, resolvedPath,
version }[]` so Settings can offer one-click "Add profile". Pure discovery; the feature
does not depend on it.

---

## 4. Chosen approach (#2) — implementation steps

### 4.1 Why a PTY (not piped stdio)

Claude Code / Codex are full-screen TUI apps. Piped `stdin`/`stdout` gives garbled
ANSI and no interactivity. They need a **pseudo-terminal**:

- **Unix (Linux/macOS):** `openpty` / `forkpty`.
- **Windows:** **ConPTY** (`CreatePseudoConsole`), built into Windows 10 1809+ and all
  of Windows 11. It lives in `kernel32.dll` and drives `conhost.exe`, which ships with
  the OS.

`portable-pty` (the crate extracted from wezterm) abstracts all of this behind one
cross-platform API. It is the de facto standard for Rust terminal work, actively
maintained, and battle-tested by wezterm itself. Alternatives (`pty-process` = Unix
only; `conpty` = Windows only; hand-rolling with `nix` + `windows` crates) offer no
upside here.

> Also evaluate **`tauri-plugin-pty`** — a community plugin wrapping `portable-pty`
> that pre-wires spawn/write/resize/kill + streaming to `xterm.js`. Same engine
> underneath; can eliminate most of the glue in 4.3–4.4. Check its maintenance status
> before depending on it.

### 4.2 Windows / portable-build specifics

- **Nothing to bundle for the PTY.** ConPTY is an OS API; a portable recallstack
  (run-from-folder, no installer, no admin, no registry) gets it for free.
- **Drop winpty.** `portable-pty` falls back to bundled `winpty.dll` + `winpty-agent.exe`
  only for Windows < 1809. Require **1809+** and ship zero extra files — keeps the
  portable story clean.
- **No console flash.** Modern `portable-pty` sets `STARTUPINFOEX` with the
  pseudoconsole attribute and does not pass `CREATE_NEW_CONSOLE`; no flicker.
  (Historic bug, resolved.)
- **Resize** on Windows is `ResizePseudoConsole` (there is no `SIGWINCH`);
  `pty.resize()` abstracts it — the Rust code is identical to the Unix path.
- **Ctrl+C:** `xterm.js` sends `\x03`; ConPTY converts it to `CTRL_C_EVENT`. Handled by
  the crate.
- **The CLI binary is still the user's responsibility** (see BYO-CLI). Portable
  recallstack cannot assume `claude.exe` / `codex.exe` is on `PATH` — hence the
  explicit path field + resolution logic in §3.2.
- **`.cmd` / `.bat` targets:** npm on Windows installs `claude.cmd`. `CreateProcess`
  will not launch those directly. If the resolved command ends in `.cmd` / `.bat`,
  wrap with `cmd /c <target> <args…>` inside the PTY. (This is the only shell-wrapping
  we do, and only for this case.)

### 4.3 Backend — Rust

**Crate:** add to `src-tauri/Cargo.toml`:

```toml
portable-pty = "0.8"   # confirm latest at implementation time
```

**New module:** `src-tauri/src/commands/ai.rs`, registered in
`src-tauri/src/commands/mod.rs` (`pub mod ai;`) and wired into the invoke handler in
`src-tauri/src/lib.rs`.

**Session state:** hold live PTY sessions in `tauri::State`:

```rust
struct AiPtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,     // pty.take_writer()
    child:  Box<dyn Child + Send + Sync>,
    reader_handle: JoinHandle<()>,
}
struct AiPtyState(Mutex<HashMap<String /* session id */, AiPtySession>>);
```

**Commands:**

1. `ai_pty_spawn(profile_id, cwd, initial_prompt) -> session_id`
   - Look up the profile from preferences (or pass the resolved fields from the
     frontend — decide who owns prefs).
   - Resolve `command` to an absolute path (§3.2). If `.cmd`/`.bat` on Windows, prefix
     `cmd /c`.
   - `let pty = native_pty_system().openpty(PtySize { rows, cols, ..default })?;`
   - Build `CommandBuilder`:
     - `cmd.cwd(cwd)` — the folder of the current file
     - `cmd.args(profile.args)`
     - `cmd.env(...)` for each `profile.env` entry
     - append the rendered initial prompt as the final positional arg
       (Claude Code: `@relfile` mention syntax works; Codex: plain string)
   - `let child = pty.slave.spawn_command(cmd)?;`
   - `let mut reader = pty.master.try_clone_reader()?;`
   - Spawn a **reader thread**: loop `reader.read(&mut buf[0; 32 KiB])`, forward bytes
     to the frontend (see 4.3.1). On EOF/err, emit a `closed` message and drop the
     session.
   - Store the session; return its id.

2. `ai_pty_write(session_id, bytes: Vec<u8>)`
   - `session.writer.write_all(&bytes)?` — raw bytes, no transformation.

3. `ai_pty_resize(session_id, rows, cols)`
   - `session.master.resize(PtySize { rows, cols, .. })?`

4. `ai_pty_kill(session_id)`
   - `child.kill()`, join the reader thread, remove from the map.

5. Lifecycle: on window close / app exit, iterate the map and kill all sessions.

**4.3.1 Output transport — use a Tauri v2 `Channel`, not events**

- `ai_pty_spawn` takes a `tauri::ipc::Channel<...>` parameter; the reader thread pushes
  chunks through it. `Channel` is built for Rust→frontend streaming and avoids the
  per-message overhead of the global event bus.
- **Pass raw bytes**, not base64. Tauri v2 moves `Vec<u8>` / `ArrayBuffer` across IPC
  without base64 inflation. Keep PTY output as bytes end-to-end. Do **not**
  `String::from_utf8` in Rust — ConPTY and Unix PTYs emit UTF-8 VT sequences that
  `xterm.js` decodes itself; lossy conversion breaks multibyte output.
- **Batch:** read into a 16–64 KiB buffer; flush on buffer-full or a ~4–8 ms timer,
  whichever first. Without this, a `yes`-style flood drowns the IPC bridge.
- **Backpressure:** the reader thread should block on a bounded channel rather than
  grow an unbounded queue when the webview lags.

### 4.4 Frontend — TypeScript

**Deps:** `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`
(and `@xterm/addon-web-links` if desired).

**Bridge wrappers** in `src/services/desktop-bridge.ts` (mirrors the existing
`invoke`-wrapper style):

```ts
aiPtySpawn(profileId, cwd, initialPrompt, onData: (bytes: Uint8Array) => void): Promise<string>
aiPtyWrite(sessionId, bytes: Uint8Array): Promise<void>
aiPtyResize(sessionId, rows, cols): Promise<void>
aiPtyKill(sessionId): Promise<void>
```

`aiPtySpawn` sets up the `Channel` and forwards chunks to `onData`.

**Panel component** (docked sidebar / bottom panel, consistent with recallstack's
layout):

1. Create `Terminal` with `FitAddon` + `WebglAddon` (fall back to canvas/DOM renderer
   if WebGL context creation throws).
2. On open:
   - compute `cwd = dirname(activeFilePath)` from whatever holds the active file today
   - render `promptTemplate` with the token map (§3.1)
   - `sessionId = await aiPtySpawn(activeProfileId, cwd, prompt, chunk => term.write(chunk))`
3. `term.onData(d => aiPtyWrite(sessionId, encoder.encode(d)))`
4. `ResizeObserver` on the container → `fitAddon.fit()` →
   `aiPtyResize(sessionId, term.rows, term.cols)` (debounce ~50 ms).
5. On panel close / file close / app teardown → `aiPtyKill(sessionId)`, `term.dispose()`.
6. Handle the `closed` signal from the backend (process exited): show an inline
   "process exited (code N) — [restart]" affordance.

**Renderer note:** the DOM renderer is the usual "terminal feels slow" culprit; the
WebGL addon is what makes full-speed TUI output smooth. This matters more than any
backend micro-optimization.

### 4.5 Context injection — how the CLI learns about the file

Most of this is free once `cwd` is correct:

- **Working directory** = the file's folder. Both CLIs auto-detect it. Claude Code also
  walks up the tree loading any `CLAUDE.md`.
- **The specific file:** the rendered `initial_prompt`. Claude Code's `@relative/path`
  syntax pulls the file into context; Codex takes a plain prompt string. Optionally add
  "user has this file open, cursor at line {{line}}".
- **Wider scope:** if the file's folder is narrower than the vault and we want the model
  to see more, add `--add-dir <workspace-root>` (Claude Code) via the profile's `args`.
- Keep `{{selection}}` length-capped so a huge selection doesn't blow the prompt.

### 4.6 Efficiency checklist (where it actually matters)

PTY overhead itself is negligible (a memcpy + a pipe). The real levers:

1. Output over a Tauri v2 **`Channel`**, not the event system.
2. **Raw bytes**, never base64; no `String` round-trip in Rust.
3. **Batch** PTY reads (16–64 KiB buffer or ~4–8 ms timer).
4. Render with **`@xterm/addon-webgl`**.
5. **Bounded** channel between reader thread and IPC → real backpressure.

### 4.7 Gotchas

- **PATH of a GUI-spawned process** differs from an interactive shell's. Less severe on
  Windows (Explorer-launched apps inherit the full registry PATH) and on Linux under a
  systemd user session, but npm global bin / `~/.local/bin` can still be missing.
  Mitigation = the explicit path field + resolution logic in §3.2; do **not** shell out
  just to get PATH.
- **First-run auth:** `claude` / `codex` may need a login flow on first use. A PTY
  handles this fine (interactive). Headless mode would not — another reason #2 beats #3
  for the first version.
- **Resize:** if `ai_pty_resize` is not wired, the TUI wraps badly. Non-optional.
- **Permissions / sandbox:** the model runs tools inside the notes folder. Claude Code
  has `--permission-mode` (e.g. `plan`); Codex sandboxes by default
  (`--sandbox workspace-write` to loosen). Decide recallstack's default and expose it
  via the profile's `args`.
- **`.cmd`/`.bat` on Windows** → `cmd /c` wrap (§4.2).
- **UTF-8 passthrough:** never decode/re-encode PTY bytes in Rust.

---

## 5. Where it lands in recallstack

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | add `portable-pty` |
| `src-tauri/src/commands/ai.rs` | **new** — PTY spawn/write/resize/kill + reader thread |
| `src-tauri/src/commands/mod.rs` | `pub mod ai;` |
| `src-tauri/src/lib.rs` | register `ai_pty_*` in the invoke handler; manage `AiPtyState`; kill sessions on exit |
| `src/app/preferences.ts` | add the `aiCli` settings block (§3.1) |
| `src/services/desktop-bridge.ts` | TS wrappers: `aiPtySpawn` / `aiPtyWrite` / `aiPtyResize` / `aiPtyKill` (+ `detectAiClis`) |
| Settings UI | master toggle, profile CRUD, detect button, `--version` validation |
| New terminal panel component | `xterm.js` + fit + webgl; lifecycle wiring to the active file |
| `package.json` | add `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl` |

---

## 6. Suggested phasing

1. **Prototype (approach #1):** one Tauri command that spawns an external terminal
   (`alacritty -e <cmd> <prompt>`) with `cwd` = file's folder. Validates cwd + prompt
   template + context injection with almost no code. Throwaway.
2. **Settings model:** implement the `aiCli` prefs block, profile CRUD, detection, and
   `--version` validation. No terminal yet — just proves BYO-CLI config.
3. **PTY backend:** `ai.rs` with spawn/write/resize/kill, `Channel` output, reader
   thread, session map, teardown on exit. Test with a dumb child (`bash` / `cmd`).
4. **Frontend panel:** `xterm.js` + WebGL + fit, bridge wrappers, resize observer,
   lifecycle. Wire to the active-file state to derive `cwd` and render the prompt.
5. **Polish:** process-exit UI + restart, error surfaces for unresolved command,
   permission-mode default, `.cmd` wrap on Windows, `{{selection}}` cap,
   `--add-dir` option.
6. **Cross-platform pass:** verify on Windows 11 portable build (ConPTY, no winpty,
   no console flash), Linux (Hyprland session PATH), macOS if in scope.

---

## 7. Open questions for later

- Who owns the profile lookup at spawn time — does the frontend pass resolved fields,
  or does `ai.rs` read preferences directly?
- One PTY session per file, or a single reusable session that we `cd` between?
- Should closing the Markdown file kill the session, or detach and keep it alive?
- Persist scrollback across panel toggles?
- Do we want a generic "open terminal here" (no AI) as a side effect of the same
  infrastructure?

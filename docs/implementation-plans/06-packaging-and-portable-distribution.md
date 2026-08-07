# Improvement 6 Implementation Plan: Packaging and Portable Distribution

**Status:** Implemented 2026-08-06; native Windows and clean Ubuntu/Arch smoke gates run in release CI
**Distribution decision:** Windows receives a portable executable only; no MSI, setup executable, or installed application  
**Primary outcome:** Produce repeatable, verifiable Windows and Arch Linux artifacts without changing workspace portability.

## Current Baseline

Tauri bundling is disabled and the package scripts use `--no-bundle`. This is appropriate for a raw executable but is not yet a complete distribution pipeline. There is no Windows-native build verification, application icon set, release metadata, signing process, AppImage, Linux tarball, PKGBUILD, checksums, or release automation.

## Implemented Result

- `package.json` is the version authority; `npm run check:versions` verifies Cargo, Cargo.lock, and Tauri metadata agree.
- PNG and multi-resolution ICO application icons and Tauri product metadata are present.
- Windows uses `tauri build --no-bundle` and produces a raw versioned executable plus a ZIP containing the executable, quick start, license, and three editable runtime sidecars: `readme.md`, `changes.md`, and `theme.json`. Static release tests reject installer targets.
- Linux has native executable, tarball, AppImage, and local released-artifact PKGBUILD commands.
- Packaging writes per-artifact SHA-256 files and a machine-readable manifest.
- The manually dispatched GitHub Actions workflow uses separate Windows 2022 and Ubuntu 22.04 jobs, runs all tests, and uploads artifacts without publishing a release.
- `docs/distribution.md` covers WebView2, Linux dependencies, data locations, upgrades, downgrades, signing status, and native smoke-test expectations.

The native Linux executable and tarball were built and inspected locally on 2026-08-06. AppImage bundling reached Tauri's bundler but the current CachyOS host rejected the bundler's AppImage tooling with a read-only-filesystem error; the controlled Ubuntu 22.04 CI job is the supported AppImage build environment, consistent with Tauri's baseline guidance. Windows executable behavior and Windows watcher semantics likewise require the native Windows job and release smoke checklist rather than cross-platform inference.

## Target Artifacts

### Windows

```text
RecallStack-<version>-windows-x86_64-portable.zip
  RecallStack.exe
  README.txt
  LICENSE
  readme.md
  changes.md
  theme.json
```

The executable must run without installation or administrative privileges. It may use the user application-data directory for preferences and logs. Workspace content remains wherever the user selects it.

Document the WebView2 runtime requirement. Decide before release whether to rely on the Windows-provided runtime or ship a fixed runtime beside the executable; the latter increases artifact size substantially.

### Arch Linux

```text
RecallStack-<version>-linux-x86_64.AppImage
RecallStack-<version>-linux-x86_64.tar.gz
PKGBUILD
```

The tarball contains the executable, desktop file, icon, license, and launch instructions. The PKGBUILD should package a released artifact rather than compiling an unpinned moving branch.

## Implementation Phases

### Phase 1: Release metadata and versioning

1. Select one version source and synchronize `package.json`, `Cargo.toml`, and `tauri.conf.json` during release checks.
2. Add release notes and changelog conventions.
3. Add production application icons in PNG and ICO formats.
4. Embed product name, version, description, and copyright metadata.
5. Record minimum supported Windows and Linux environments.

### Phase 2: Reproducible local builds

Create explicit scripts:

- `build:windows:portable`: runs on Windows and produces the raw release `.exe`.
- `package:windows:portable`: creates the ZIP and checksum without an installer.
- `build:linux`: builds the native executable.
- `package:linux:tar`: assembles the portable tarball.
- `package:linux:appimage`: invokes the supported Tauri/AppImage process.

Build scripts must start from a clean output directory, fail on warnings selected as release-blocking, and print final artifact paths and hashes.

### Phase 3: Windows portable behavior

1. Test from an ordinary non-administrator account.
2. Test from Downloads, Desktop, removable storage, and a path containing spaces.
3. Ensure no installer registry keys, shortcuts, services, or uninstall entries are created.
4. Ensure application data is limited to documented user-data locations.
5. Confirm workspace paths are stored per user and do not assume the executable’s location.
6. Test missing/outdated WebView2 behavior and display a useful error.
7. Add optional code signing when a certificate is available; unsigned builds must be clearly labeled.

### Phase 4: Arch Linux packages

1. Define runtime dependencies such as WebKitGTK and GTK according to the built Tauri version.
2. Build and test the AppImage on a clean supported environment.
3. Create a portable tarball with a launcher and desktop integration files.
4. Create and lint a PKGBUILD.
5. Test Wayland and X11 sessions.
6. Verify file dialogs, reveal-in-file-manager, clipboard, and external links.

### Phase 5: Release automation

Use separate native jobs because Windows portable artifacts should be built on Windows:

1. Validate versions and lockfiles.
2. Run frontend tests, Rust tests, and build checks.
3. Build Windows and Linux artifacts.
4. Generate SHA-256 checksums and a machine-readable artifact manifest.
5. Sign artifacts when credentials are configured.
6. Attach artifacts and release notes to the selected release host.

Do not publish automatically from an unreviewed branch.

## Required Documentation

- Windows portable quick start.
- WebView2 requirement and troubleshooting.
- Linux dependencies and launch instructions.
- Exact application-data and log locations.
- Workspace backup expectations.
- Upgrade procedure: close app, replace executable, reopen workspace.
- Downgrade/database compatibility policy.

## Testing Strategy

- Artifact smoke test on clean Windows and Arch virtual machines.
- Launch from read-only and removable locations.
- Paths containing spaces and non-ASCII characters.
- Open, edit, save, search, backup, and close/reopen test.
- Antivirus/SmartScreen observation for unsigned Windows builds.
- Checksum verification and archive-content tests.

## Completion Criteria

- Windows release creates only the portable ZIP and raw `.exe`; no installer is produced.
- Windows executable launches on the documented baseline without administrator access.
- AppImage, Linux tarball, and PKGBUILD install/run successfully on clean test systems.
- Artifacts are versioned, checksummed, and reproducible through documented commands.
- Release documentation identifies runtime requirements and data locations.

## Risks and Controls

- **WebView runtime ambiguity:** document and test the chosen WebView2 policy.
- **Unsigned Windows warnings:** support signing but never conceal unsigned status.
- **Linux ABI variation:** build in a controlled baseline and test the AppImage independently.
- **Version drift:** automated consistency check across manifests.

## Out of Scope

- Windows MSI or NSIS installers.
- Microsoft Store distribution.
- Automatic self-update until signing and rollback policies exist.

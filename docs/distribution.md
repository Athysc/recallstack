# RecallStack distribution

RecallStack 0.1.x supports 64-bit Windows 10/11 with the Microsoft Edge WebView2 Evergreen Runtime, 64-bit Arch Linux with GTK 3 and WebKitGTK 4.1, and macOS 11+ (Apple Silicon and Intel, via a universal binary) using the system WebKit engine. All three platforms are portable only: no MSI, setup program, DMG, PKG, registry installer entries, services, shortcuts, or uninstaller are produced.

## Release verification and versioning

`package.json` is the release version source. Update the matching values in `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`, then run:

```bash
npm run release:verify
```

Release notes use a version heading (`## 0.2.0 — YYYY-MM-DD`) in `CHANGELOG.md`, grouped under Added, Changed, Fixed, and Known limitations. Artifact commands generate individual SHA-256 files and `release/artifact-manifest.json`.

## Windows portable release

Run these commands on 64-bit Windows:

```powershell
npm run release:clean
npm run build:windows:portable
npm run package:windows:portable
```

The release directory contains a raw `.exe` and `RecallStack-<version>-windows-x86_64-portable.zip`. The ZIP contains `RecallStack.exe`, `README.txt`, `LICENSE`, `readme.md`, `changes.md`, and `theme.json`. Keep all six together after extraction. The three lowercase sidecars remain editable and are also embedded as startup fallbacks. Signing is optional when a certificate is configured; the manifest identifies Windows artifacts as unsigned by default. Test an unsigned release from an ordinary non-administrator account because SmartScreen reputation warnings are expected.

If RecallStack does not open, install or repair the WebView2 Evergreen Runtime from Microsoft. The runtime is not copied beside RecallStack because the fixed-runtime distribution is much larger.

## Linux and Arch release

### Build locally on Arch Linux

Install the Tauri 2 build dependencies, Node.js, npm, and the Rust toolchain:

```bash
sudo pacman -Syu
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl \
  wget \
  file \
  openssl \
  appmenu-gtk-module \
  libappindicator-gtk3 \
  librsvg \
  xdotool \
  nodejs \
  npm \
  rustup

rustup default stable
```

From the RecallStack repository, install the locked JavaScript dependencies,
verify the release, and build both Linux formats:

```bash
npm ci
npm run release:verify
npm run release:clean
npm run build:linux
npm run package:linux:tar
npm run build:linux:appimage
npm run package:linux:appimage
```

The resulting AppImage, portable tarball, checksums, artifact manifest, and
generated `PKGBUILD` are written to `release/`. Run the portable AppImage with:

```bash
chmod +x release/RecallStack-*-linux-x86_64.AppImage
./release/RecallStack-*-linux-x86_64.AppImage
```

Keep `readme.md`, `changes.md`, and `theme.json` beside the AppImage so their
external, editable versions remain available. If the AppImage reports a FUSE
error, install the Arch `fuse2` package:

```bash
sudo pacman -S --needed fuse2
```

The tarball contains the executable, desktop entry, 128 px icon, license, and launch guide. The generated `release/PKGBUILD` consumes that exact local, versioned tarball and pins its SHA-256 digest. Place both files together before running `makepkg -si`. Validate the AppImage independently under Wayland and X11.

## macOS release

macOS artifacts must be built natively on a Mac. Building the universal binary
requires both Rust targets:

```bash
rustup default stable
rustup target add aarch64-apple-darwin x86_64-apple-darwin
cd /path/to/RecallStack
npm ci
```

Verify, build, and package the universal `.app`:

```bash
npm run release:verify
npm run release:clean
npm run build:macos:app
npm run package:macos:app
```

`build:macos:app` runs `tauri build --target universal-apple-darwin --bundles app`,
producing a single `RecallStack.app` containing both an Apple Silicon and an
Intel binary (a "fat" Mach-O), at
`src-tauri/target/universal-apple-darwin/release/bundle/macos/RecallStack.app`.
`package:macos:app` stages that bundle with `LICENSE`, `README.txt`, and the
editable `readme.md`/`changes.md`/`theme.json` sidecars, then zips it to
`release/RecallStack-<version>-macos-universal.zip`.

RecallStack.app is not signed with an Apple Developer ID and is not notarized,
because the reviewed release process does not depend on paid Apple Developer
credentials. On first launch, Gatekeeper blocks the app; the user must
right-click → Open (and confirm) once, or run `xattr -cr RecallStack.app` from
Terminal to clear the quarantine flag. This is documented in the zip's
`README.txt`. No separate WebView runtime is required — RecallStack uses the
WebKit engine already built into macOS.

## Data, upgrades, and downgrades

Workspace Markdown and assets remain where the user selected them. Platform app-data stores preferences and recent workspace history under the Tauri identifier `com.recallstack.desktop` (normally `%LOCALAPPDATA%` on Windows, `$XDG_DATA_HOME` or `~/.local/share` on Linux, and `~/Library/Application Support` on macOS). RecallStack does not make the selected workspace portable by moving it beside the executable.

To upgrade, close RecallStack, replace the executable or extracted directory, and reopen the workspace. Back up the workspace before upgrades and downgrades. Markdown stays canonical; `DB/index.db` is rebuildable. Downgrading is not guaranteed after a newer version changes preferences or the index schema.

Before release, smoke-test launch and open/edit/save/search/backup/close/reopen from Downloads, Desktop, removable/read-only media where applicable, paths containing spaces and non-ASCII characters, and ordinary user accounts. Windows, Arch, and macOS (both Apple Silicon and Intel, or Rosetta) checks remain release gates because they cannot be proven by a build on another operating system. On macOS, also confirm the Gatekeeper right-click-Open path and the `xattr -cr` fallback both work on a freshly downloaded, quarantined copy of the app.

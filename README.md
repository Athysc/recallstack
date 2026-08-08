# RecallStack Desktop

The Tauri 2 desktop port of RecallStack. Markdown files under `Data/` remain canonical. `DB/index.db` is a native SQLite FTS5 index that can always be rebuilt.

## Recent changes (2026-08-08)

- Added a multi-file tab strip above the editor, with drag-to-reorder, a dirty-state indicator, and a close button per tab.
- Added a "Waiting" task status alongside QA, Deployment, and Deployed.
- Fixed a frontend parity-check regression (`recallstack.html` had drifted from `index.html`/the modular CSS) and a macOS-only release build failure caused by an upstream `zune-jpeg` compiler incompatibility, both of which were breaking the reviewed release workflow.

## Development

```bash
npm install
npm run tauri:dev
```

## Portable Windows executable

RecallStack intentionally does **not** create an MSI or setup installer. Build the standalone executable with:

```bash
npm run release:verify
npm run release:clean
npm run build:windows:portable
npm run package:windows:portable
```

The versioned raw executable, portable ZIP, SHA-256 files, and artifact manifest are written to `release/`. It can be copied and run directly; workspace data stays in the selected workspace and app settings/recent-workspace list live in the user app-data directory. RecallStack relies on the Microsoft Edge WebView2 Evergreen Runtime included with supported Windows 10/11 systems.

RecallStack also builds a portable, unsigned universal `.app` for macOS (Apple Silicon and Intel in one binary) with:

```bash
npm run build:macos:app
npm run package:macos:app
```

The macOS build must run natively on a Mac. Because the app is unsigned and unnotarized, Gatekeeper blocks the first launch until the user right-clicks → Open (or clears the quarantine attribute with `xattr -cr`); this is documented in the packaged `README.txt`.

## Arch Linux: build and install

RecallStack does not have a repository/AUR package yet, so build it locally.

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

From the RecallStack repository, install the locked JavaScript dependencies, verify the release, and build both Linux artifact formats:

```bash
npm ci
npm run release:verify
npm run release:clean
npm run build:linux
npm run package:linux:tar
npm run build:linux:appimage
npm run package:linux:appimage
```

This writes an AppImage, a portable tarball, SHA-256 checksums, an artifact manifest, and a generated `PKGBUILD` to `release/`. Install with `makepkg` (the `PKGBUILD` pins the exact local tarball and its checksum, so keep both files together):

```bash
cd release
makepkg -si
```

Or run the AppImage directly without installing:

```bash
chmod +x release/RecallStack-*-linux-x86_64.AppImage
./release/RecallStack-*-linux-x86_64.AppImage
```

If the AppImage reports a FUSE error, install `fuse2`:

```bash
sudo pacman -S --needed fuse2
```

Keep `readme.md`, `changes.md`, and `theme.json` beside the AppImage (or wherever `makepkg -si` installs the binary) so their externally editable versions stay available; embedded defaults are used as a fallback otherwise.

For Linux tarball/AppImage details beyond Arch, macOS build and Gatekeeper notes, runtime requirements, upgrade policy, and release verification, see [docs/distribution.md](docs/distribution.md#build-locally-on-arch-linux).

## Desktop architecture

The desktop build runs the established interface through `index.html` and the TypeScript entry at `src/main.ts`. `recallstack.html` is retained only as a byte-parity reference and is not loaded or bundled. A Tauri compatibility layer implements browser File System Access handles with native Rust commands, so the existing notes, tasks, calendar, assets, outputs, themes, and navigation remain available without redesigning the application. Markdown remains canonical in the selected workspace.

The in-app guide, change history, and editable theme catalog are loaded from `readme.md`, `changes.md`, and `theme.json` beside the executable. Embedded defaults and legacy workspace files provide fallbacks. See [docs/themes.md](docs/themes.md) for the theme schema.

## Ownership and license

Copyright © 2026 Sam Chiang. All rights reserved.

RecallStack is publicly viewable source, not open-source software. No permission is granted to copy, modify, distribute, sublicense, or sell RecallStack except under a separate written agreement from the copyright holder. See [LICENSE](LICENSE). Third-party dependencies and bundled libraries remain subject to their respective licenses.

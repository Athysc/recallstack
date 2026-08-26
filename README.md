# RecallStack Desktop

The Tauri 2 desktop port of RecallStack. Markdown files under `Data/` remain canonical. `DB/index.db` is a native SQLite FTS5 index that can always be rebuilt.

## Recent changes (2026-08-08)

- Added a multi-file tab strip above the editor, with drag-to-reorder, a dirty-state indicator, and a close button per tab.
- Added a "Waiting" task status alongside QA, Deployment, and Deployed.
- Fixed a macOS-only release build failure caused by an upstream `zune-jpeg` compiler incompatibility that was breaking the reviewed release workflow.

## Development

RecallStack standardizes development and CI on Node.js 24 with npm 11. With
[mise](https://mise.jdx.dev/) or [nvm](https://github.com/nvm-sh/nvm), select the
repository version before installing dependencies:

```bash
mise install                 # or: nvm install && nvm use
npm ci
npm run tauri:dev
```

The checked-in `allowScripts` policy approves only the pinned esbuild install
scripts required by Vite. EdgeDriver and GeckoDriver install scripts are
explicitly denied because RecallStack's desktop E2E suite uses Tauri's embedded
driver instead of either browser-specific driver.

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

On current Arch-derived systems, gdk-pixbuf 2.44 no longer installs its legacy
loader directory. The AppImage build detects that layout and automatically uses
a package-local compatibility shim for Tauri's linuxdeploy GTK plugin; it does
not modify `/usr` or the downloaded plugin cache.

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

The desktop build runs through `index.html` and the TypeScript entry at `src/main.ts`. Screenshot and native end-to-end tests cover the production interface directly; the former monolithic HTML parity fixture has been retired. A Tauri workspace facade exposes native Rust filesystem commands to the frontend. Rust SQLite is the sole search index; there is no browser/IndexedDB or sql.js runtime. Markdown remains canonical in the selected workspace.

The in-app guide, change history, and editable theme catalog are loaded from `readme.md`, `changes.md`, and `theme.json` beside the executable. Embedded defaults and legacy workspace files provide fallbacks. See [docs/themes.md](docs/themes.md) for the theme schema.

## Ownership and license

Copyright © 2026 Sam Chiang. All rights reserved.

RecallStack is publicly viewable source, not open-source software. No permission is granted to copy, modify, distribute, sublicense, or sell RecallStack except under a separate written agreement from the copyright holder. See [LICENSE](LICENSE). Third-party dependencies and bundled libraries remain subject to their respective licenses.

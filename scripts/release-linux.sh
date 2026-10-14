#!/usr/bin/env bash
# Full Linux release: verify, build, package, then install the Arch package.
set -euo pipefail

cd "$(dirname "$0")/.."

npm ci
npm run release:verify
npm run release:clean
npm run build:linux
npm run package:linux:tar
npm run build:linux:appimage
npm run package:linux:appimage

cd release
makepkg -si

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const tauri = JSON.parse(await readFile(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
const workflow = await readFile(resolve(root, ".github/workflows/release-artifacts.yml"), "utf8");
const windowsReadme = await readFile(resolve(root, "packaging/windows/README.txt"), "utf8");
const packageScript = await readFile(resolve(root, "scripts/package-release.mjs"), "utf8");

assert.equal(tauri.productName, "RecallStack");
assert.equal(tauri.bundle.active, false, "default Tauri bundling must remain disabled");
assert.deepEqual(tauri.bundle.targets, [], "default Tauri config must not produce installers");
assert.match(packageJson.scripts["build:windows:portable"], /--no-bundle/);
assert.doesNotMatch(packageJson.scripts["build:windows:portable"], /msi|nsis|wix|setup/i);
assert.match(packageJson.scripts["package:windows:portable"], /windows-portable/);
assert.match(packageScript, /RecallStack\.exe/);
assert.match(packageScript, /README\.txt/);
assert.match(packageScript, /LICENSE/);
assert.match(packageScript, /portable\/readme\.md/);
assert.match(packageScript, /portable\/changes\.md/);
assert.match(packageScript, /themes\.json/);
assert.match(windowsReadme, /No installation or administrator access is required/);
assert.match(windowsReadme, /WebView2 Evergreen Runtime/);
assert.match(workflow, /workflow_dispatch/);
assert.doesNotMatch(workflow, /^\s+push:/m, "release artifacts must not publish automatically from a push");
assert.match(workflow, /actions\/checkout@v6/);
assert.match(workflow, /actions\/setup-node@v6/);
assert.match(workflow, /actions\/upload-artifact@v6/);
assert.match(workflow, /node-version:\s*24/);
assert.doesNotMatch(
  workflow,
  /actions\/(?:checkout|setup-node|upload-artifact)@v[1-4]\b/,
  "release workflow must use Node 24-based GitHub actions",
);
assert.match(workflow, /runs-on: windows-2022/);
assert.match(workflow, /runs-on: ubuntu-22\.04/);

await Promise.all([
  "LICENSE",
  "CHANGELOG.md",
  "packaging/arch/PKGBUILD.template",
  "packaging/linux/com.recallstack.desktop.desktop",
  "portable/readme.md",
  "portable/changes.md",
  "src-tauri/icons/icon.png",
  "src-tauri/icons/icon.ico",
].map((path) => access(resolve(root, path))));

console.log("Release configuration verified: portable Windows only, native Windows/Linux CI, icons, metadata, and documentation present.");

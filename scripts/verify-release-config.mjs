import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const nvmrc = await readFile(resolve(root, ".nvmrc"), "utf8");
const miseConfig = await readFile(resolve(root, "mise.toml"), "utf8");
const tauri = JSON.parse(await readFile(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
const workflow = await readFile(resolve(root, ".github/workflows/release-artifacts.yml"), "utf8");
const frontendWorkflow = await readFile(resolve(root, ".github/workflows/frontend-e2e.yml"), "utf8");
const frontendE2eSpec = await readFile(resolve(root, "tests/e2e/specs/recallstack.e2e.mjs"), "utf8");
const frontendE2eRunner = await readFile(resolve(root, "scripts/run-frontend-e2e.mjs"), "utf8");
const releasePerformanceRunner = await readFile(resolve(root, "scripts/run-release-performance.mjs"), "utf8");
const linuxAppImageRunner = await readFile(resolve(root, "scripts/build-linux-appimage.mjs"), "utf8");
const appImagePkgconfShim = await readFile(resolve(root, "scripts/appimage-tools/pkgconf"), "utf8");
const windowsIdlePerformanceRunner = await readFile(resolve(root, "scripts/run-windows-idle-performance.mjs"), "utf8");
const releasePerformanceSpec = await readFile(resolve(root, "tests/e2e/specs/release-performance.e2e.mjs"), "utf8");
const windowsReadme = await readFile(resolve(root, "packaging/windows/README.txt"), "utf8");
const macosReadme = await readFile(resolve(root, "packaging/macos/README.txt"), "utf8");
const packageScript = await readFile(resolve(root, "scripts/package-release.mjs"), "utf8");

assert.equal(tauri.productName, "RecallStack");
assert.equal(packageJson.engines.node, "24.x");
assert.equal(packageJson.engines.npm, "11.x");
assert.equal(nvmrc.trim(), "24");
assert.match(miseConfig, /^node\s*=\s*"24"$/m);
assert.equal(packageJson.devEngines.runtime.version, "^24.0.0");
assert.equal(packageJson.devEngines.packageManager.version, "^11.0.0");
assert.equal(packageJson.allowScripts["esbuild@0.25.12"], true);
assert.equal(packageJson.allowScripts["esbuild@0.28.2"], true);
assert.equal(packageJson.allowScripts.edgedriver, false);
assert.equal(packageJson.allowScripts.geckodriver, false);
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
assert.match(packageJson.scripts["build:macos:app"], /universal-apple-darwin/);
assert.match(packageJson.scripts["build:macos:app"], /--bundles app/);
assert.doesNotMatch(packageJson.scripts["build:macos:app"], /dmg|pkg|installer/i);
assert.match(packageJson.scripts["package:macos:app"], /macos-app/);
assert.match(packageScript, /RecallStack\.app/);
assert.match(macosReadme, /quarantine/i);
assert.match(macosReadme, /xattr -cr/);
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
assert.match(workflow, /runs-on: macos-14/);
assert.equal(packageJson.scripts["test:release:performance"], "node scripts/run-release-performance.mjs");
assert.equal(packageJson.scripts["build:linux:appimage"], "node scripts/build-linux-appimage.mjs");
assert.match(linuxAppImageRunner, /RECALLSTACK_APPIMAGE_GDK_PIXBUF_COMPAT/);
assert.match(linuxAppImageRunner, /NO_STRIP:\s*"1"/);
assert.match(appImagePkgconfShim, /gdk_pixbuf_binarydir/);
assert.equal(packageJson.scripts["test:windows-idle:performance"], "node scripts/run-windows-idle-performance.mjs");
for (const runner of [frontendE2eRunner, releasePerformanceRunner]) {
  assert.match(runner, /process\.execPath/);
  assert.match(runner, /npm_execpath/);
  assert.doesNotMatch(runner, /npm\.cmd|npx\.cmd/);
}
assert.match(windowsIdlePerformanceRunner, /RECALLSTACK_WINDOWS_IDLE_E2E:\s*"1"/);
assert.match(workflow, /RECALLSTACK_WINDOWS_IDLE_E2E:\s*"1"/);
assert.match(releasePerformanceSpec, /plugin:window\|minimize/);
assert.match(releasePerformanceSpec, /plugin:window\|unminimize/);
assert.match(releasePerformanceSpec, /360_000/);
assert.match(workflow, /performance-results\/windows\.json/);
assert.match(workflow, /performance-results\/linux\.json/);
assert.equal(
  workflow.match(/npm run release:verify/g)?.length,
  3,
  "Every Windows, Linux, and macOS release job must run release:verify",
);
assert.match(frontendWorkflow, /noto-fonts noto-fonts-emoji/);
assert.match(frontendE2eSpec, /verifyLayoutAtAllSizes/);
assert.match(frontendE2eSpec, /document\.documentElement\.style\.getPropertyValue/);
assert.doesNotMatch(frontendE2eSpec, /checkElement|checkScreen|visualMismatchBudget/);
assert.match(frontendWorkflow, /actions\/upload-artifact@v6/);
assert.match(frontendWorkflow, /tests\/e2e\/\.visual-output\//);
assert.match(frontendWorkflow, /include-hidden-files:\s*true/);

await Promise.all([
  "LICENSE",
  "CHANGELOG.md",
  "packaging/arch/PKGBUILD.template",
  "packaging/linux/com.recallstack.desktop.desktop",
  "packaging/macos/README.txt",
  "portable/readme.md",
  "portable/changes.md",
  "src-tauri/icons/icon.png",
  "src-tauri/icons/icon.ico",
  "src-tauri/icons/icon.icns",
].map((path) => access(resolve(root, path))));

console.log("Release configuration verified: portable Windows/Linux/macOS artifacts, native Windows/Linux/macOS CI, icons, metadata, and documentation present.");

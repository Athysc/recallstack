import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const releaseDir = resolve(root, "release");
const mode = process.argv[2];
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const version = packageJson.version;

if (mode === "clean") {
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });
  console.log(`Clean release directory: ${releaseDir}`);
  process.exit(0);
}

await mkdir(releaseDir, { recursive: true });

if (mode === "windows-portable") await packageWindows();
else if (mode === "linux-tar") await packageLinuxTar();
else if (mode === "linux-appimage") await packageLinuxAppImage();
else if (mode === "macos-app") await packageMacosApp();
else throw new Error("Usage: package-release.mjs clean|windows-portable|linux-tar|linux-appimage|macos-app");

await writeArtifactMetadata();

async function packageWindows() {
  const executable = resolve(root, "src-tauri/target/x86_64-pc-windows-msvc/release/recallstack.exe");
  await requireFile(executable, "Build the Windows executable first with npm run build:windows:portable");
  const stage = resolve(releaseDir, `.stage-windows-${version}`);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await cp(executable, resolve(stage, "RecallStack.exe"));
  const rawExecutable = resolve(releaseDir, `RecallStack-${version}-windows-x86_64-portable.exe`);
  await cp(executable, rawExecutable);
  await copyPortableDocuments(releaseDir);
  await cp(resolve(root, "LICENSE"), resolve(stage, "LICENSE"));
  await cp(resolve(root, "packaging/windows/README.txt"), resolve(stage, "README.txt"));
  await copyPortableDocuments(stage);
  const artifact = resolve(releaseDir, `RecallStack-${version}-windows-x86_64-portable.zip`);
  await createZipArchive(stage, artifact);
  await rm(stage, { recursive: true, force: true });
  console.log(`Windows portable ZIP: ${artifact}`);
  console.log(`Windows portable executable: ${rawExecutable}`);
}

async function packageLinuxTar() {
  const executable = resolve(root, "src-tauri/target/release/recallstack");
  await requireFile(executable, "Build the Linux executable first with npm run build:linux");
  const directoryName = `RecallStack-${version}`;
  const stageRoot = resolve(releaseDir, ".stage-linux");
  const stage = resolve(stageRoot, directoryName);
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(resolve(stage, "share/applications"), { recursive: true });
  await mkdir(resolve(stage, "share/icons/hicolor/128x128/apps"), { recursive: true });
  await cp(executable, resolve(stage, "recallstack"));
  await cp(resolve(root, "LICENSE"), resolve(stage, "LICENSE"));
  await cp(resolve(root, "packaging/linux/README.txt"), resolve(stage, "README.txt"));
  await copyPortableDocuments(stage);
  await cp(resolve(root, "packaging/linux/com.recallstack.desktop.desktop"), resolve(stage, "share/applications/com.recallstack.desktop.desktop"));
  await cp(resolve(root, "src-tauri/icons/icon.png"), resolve(stage, "share/icons/hicolor/128x128/apps/com.recallstack.desktop.png"));
  const artifact = resolve(releaseDir, `RecallStack-${version}-linux-x86_64.tar.gz`);
  await rm(artifact, { force: true });
  run("tar", ["-czf", artifact, directoryName], stageRoot);
  await rm(stageRoot, { recursive: true, force: true });
  const digest = await sha256(artifact);
  const template = await readFile(resolve(root, "packaging/arch/PKGBUILD.template"), "utf8");
  await writeFile(resolve(releaseDir, "PKGBUILD"), template.replaceAll("@VERSION@", version).replaceAll("@SHA256@", digest));
  console.log(`Linux portable tarball: ${artifact}`);
  console.log(`Arch PKGBUILD: ${resolve(releaseDir, "PKGBUILD")}`);
}

async function packageLinuxAppImage() {
  const directory = resolve(root, "src-tauri/target/release/bundle/appimage");
  let source;
  try { source = (await readdir(directory)).find((name) => name.endsWith(".AppImage")); }
  catch { /* handled by the actionable error below */ }
  if (!source) throw new Error("Build the AppImage first with npm run build:linux:appimage");
  const artifact = resolve(releaseDir, `RecallStack-${version}-linux-x86_64.AppImage`);
  await cp(resolve(directory, source), artifact);
  console.log(`Linux AppImage: ${artifact}`);
}

async function packageMacosApp() {
  const appBundle = resolve(root, "src-tauri/target/universal-apple-darwin/release/bundle/macos/RecallStack.app");
  await requireDir(appBundle, "Build the macOS app bundle first with npm run build:macos:app");
  const stage = resolve(releaseDir, `.stage-macos-${version}`);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await cp(appBundle, resolve(stage, "RecallStack.app"), { recursive: true });
  await cp(resolve(root, "LICENSE"), resolve(stage, "LICENSE"));
  await cp(resolve(root, "packaging/macos/README.txt"), resolve(stage, "README.txt"));
  await copyPortableDocuments(stage);
  const artifact = resolve(releaseDir, `RecallStack-${version}-macos-universal.zip`);
  await createZipArchive(stage, artifact);
  await rm(stage, { recursive: true, force: true });
  console.log(`macOS universal app ZIP: ${artifact}`);
}

async function createZipArchive(stage, artifact) {
  await rm(artifact, { force: true });
  if (process.platform === "win32") {
    run("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${escapePowershell(stage)}\\*' -DestinationPath '${escapePowershell(artifact)}' -Force`]);
  } else {
    run("zip", ["-q", "-r", artifact, "."], stage);
  }
}

async function writeArtifactMetadata() {
  const entries = [];
  for (const name of (await readdir(releaseDir)).sort()) {
    if (name.startsWith(".") || name.endsWith(".sha256") || name === "artifact-manifest.json") continue;
    const path = resolve(releaseDir, name);
    if (!(await stat(path)).isFile()) continue;
    const digest = await sha256(path);
    const size = (await stat(path)).size;
    entries.push({ name, size, sha256: digest, unsigned: name.endsWith(".zip") || name.endsWith(".exe") });
    await writeFile(`${path}.sha256`, `${digest}  ${name}\n`);
    console.log(`${digest}  ${path}`);
  }
  await writeFile(resolve(releaseDir, "artifact-manifest.json"), `${JSON.stringify({ version, generatedAt: new Date().toISOString(), artifacts: entries }, null, 2)}\n`);
}

async function copyPortableDocuments(destination) {
  await cp(resolve(root, "portable/readme.md"), resolve(destination, "readme.md"));
  await cp(resolve(root, "portable/changes.md"), resolve(destination, "changes.md"));
  await cp(resolve(root, "themes.json"), resolve(destination, "theme.json"));
}

async function requireFile(path, message) {
  try { if ((await stat(path)).isFile()) return; } catch { /* handled below */ }
  throw new Error(`${message}\nMissing: ${path}`);
}

async function requireDir(path, message) {
  try { if ((await stat(path)).isDirectory()) return; } catch { /* handled below */ }
  throw new Error(`${message}\nMissing: ${path}`);
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function escapePowershell(value) {
  return value.replaceAll("'", "''");
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const tauriConfig = JSON.parse(await readFile(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
const cargoToml = await readFile(resolve(root, "src-tauri/Cargo.toml"), "utf8");
const cargoLock = await readFile(resolve(root, "src-tauri/Cargo.lock"), "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const lockVersion = cargoLock.match(/\[\[package\]\]\r?\nname = "recallstack"\r?\nversion = "([^"]+)"/)?.[1];

assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "package.json has an invalid release version");
assert.equal(cargoVersion, packageJson.version, "Cargo.toml version differs from package.json");
assert.equal(lockVersion, packageJson.version, "Cargo.lock RecallStack version differs from package.json");
assert.equal(tauriConfig.version, packageJson.version, "tauri.conf.json version differs from package.json");
console.log(`Release versions agree: ${packageJson.version}`);

import { cpSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(import.meta.dirname, "fixtures/workspace");
const workspace = resolve(import.meta.dirname, ".workspace");
const binary = process.env.RECALLSTACK_E2E_BINARY
  ? resolve(root, process.env.RECALLSTACK_E2E_BINARY)
  : resolve(root, "src-tauri/target/debug", process.platform === "win32" ? "recallstack.exe" : "recallstack");
const fixtureTimestamp = new Date("2026-08-10T12:00:00Z");

function normalizeFixtureTimestamps(directory) {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) normalizeFixtureTimestamps(path);
    else utimesSync(path, fixtureTimestamp, fixtureTimestamp);
  }
}
export const config = {
  specs: [resolve(import.meta.dirname, "specs/recallstack.e2e.mjs")],
  maxInstances: 1,
  capabilities: [{
    maxInstances: 1,
    "tauri:options": { application: binary },
  }],
  services: [["@wdio/tauri-service", {
    appBinaryPath: binary,
    driverProvider: "embedded",
    embeddedPort: 4445,
    captureBackendLogs: true,
  }]],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 120_000 },
  logLevel: "warn",
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  onPrepare() {
    rmSync(resolve(import.meta.dirname, ".visual-output"), { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    mkdirSync(workspace, { recursive: true });
    cpSync(fixture, workspace, { recursive: true });
    normalizeFixtureTimestamps(workspace);
  },
  onComplete() {
    rmSync(workspace, { recursive: true, force: true });
  },
};

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
    // tauri-plugin-wdio-webdriver's embedded server binds its own OS thread
    // and a fresh Tokio runtime (see server::start() in that crate) rather
    // than signalling readiness back to the plugin's setup() hook
    // synchronously, so the first /status poll can race a slow/busy CI host
    // (a just-linked release binary's very first launch, disk contention,
    // etc.). @wdio/tauri-service's own docs call this out explicitly under
    // statusPollTimeout: "a healthy-but-busy server may miss the default
    // deadline and trigger a false-positive restart" — default is 2000ms,
    // which this repo's CI runs (both GitHub-hosted Windows and Linux
    // release-artifacts.yml jobs, and the frontend-e2e.yml Linux job) have
    // observed exactly that failure signature against: a WebDriver timeout
    // on the very first command. See task_20260815_0002.
    statusPollTimeout: 15_000,
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

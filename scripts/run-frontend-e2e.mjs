import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const ifAvailable = process.argv.includes("--if-available");
const npmCli = process.env.npm_execpath;
const wdioCli = resolve(root, "node_modules/@wdio/cli/bin/wdio.js");

function executableOnPath(name) {
  return (process.env.PATH || "").split(delimiter).some(directory => {
    const executable = resolve(directory, process.platform === "win32" ? `${name}.exe` : name);
    return existsSync(executable);
  });
}

function completedStatus(label, result) {
  if (result.error) console.error(`${label} failed to start:`, result.error);
  else if (result.signal) console.error(`${label} terminated by signal ${result.signal}.`);
  else if (result.status !== 0) console.error(`${label} exited with status ${result.status}.`);
  return result.status ?? 1;
}

if (ifAvailable) {
  if (process.platform !== "linux") {
    console.log("Frontend desktop E2E is currently run by the dedicated Linux CI workflow.");
    process.exit(0);
  }
  if (!process.env.RECALLSTACK_E2E_DISPLAY) {
    if (!executableOnPath("xvfb-run")) {
      console.log("Frontend E2E skipped during aggregate verification: xvfb-run is not installed. Run npm run test:frontend:e2e in a suitable display or install Xvfb.");
      process.exit(0);
    }
    const nested = spawnSync("xvfb-run", ["-a", "node", "scripts/run-frontend-e2e.mjs"], {
      cwd: root,
      env: { ...process.env, RECALLSTACK_E2E_DISPLAY: "1", XDG_SESSION_TYPE: "x11", WAYLAND_DISPLAY: "" },
      stdio: "inherit",
    });
    process.exit(nested.status ?? 1);
  }
}

if (!npmCli || !existsSync(npmCli)) {
  console.error("npm_execpath does not point to npm's CLI; run this command through npm run test:frontend:e2e.");
  process.exit(1);
}
if (!existsSync(wdioCli)) {
  console.error(`Local WebdriverIO CLI not found at ${wdioCli}; run npm ci first.`);
  process.exit(1);
}

const build = spawnSync(process.execPath, [
  npmCli, "run", "tauri", "build", "--", "--debug", "--no-bundle",
  "--config", "src-tauri/tauri.e2e.conf.json", "--", "--features", "e2e",
], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(completedStatus("Frontend E2E application build", build));

const result = spawnSync(process.execPath, [wdioCli, "run", "tests/e2e/wdio.conf.mjs"], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
process.exit(completedStatus("Frontend E2E desktop driver", result));

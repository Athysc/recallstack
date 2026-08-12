import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const platform = process.platform === "win32" ? "windows" : "linux";
const npmCli = process.env.npm_execpath;
const wdioCli = resolve(root, "node_modules/@wdio/cli/bin/wdio.js");
if (process.platform !== "win32" && process.platform !== "linux") {
  console.error("Release performance timing currently targets Windows and Linux.");
  process.exit(1);
}

function executableOnPath(name) {
  return (process.env.PATH || "").split(delimiter).some(directory => existsSync(resolve(directory, process.platform === "win32" ? `${name}.exe` : name)));
}

function completedStatus(label, result) {
  if (result.error) console.error(`${label} failed to start:`, result.error);
  else if (result.signal) console.error(`${label} terminated by signal ${result.signal}.`);
  else if (result.status !== 0) console.error(`${label} exited with status ${result.status}.`);
  return result.status ?? 1;
}

if (process.platform === "linux" && !process.env.RECALLSTACK_E2E_DISPLAY) {
  if (!executableOnPath("xvfb-run")) {
    console.error("xvfb-run is required for headless Linux release timing.");
    process.exit(1);
  }
  const nested = spawnSync("xvfb-run", ["-a", "node", "scripts/run-release-performance.mjs"], {
    cwd: root,
    env: { ...process.env, RECALLSTACK_E2E_DISPLAY: "1", XDG_SESSION_TYPE: "x11", WAYLAND_DISPLAY: "" },
    stdio: "inherit",
  });
  process.exit(nested.status ?? 1);
}

if (!npmCli || !existsSync(npmCli)) {
  console.error("npm_execpath does not point to npm's CLI; run this command through npm run test:release:performance.");
  process.exit(1);
}
if (!existsSync(wdioCli)) {
  console.error(`Local WebdriverIO CLI not found at ${wdioCli}; run npm ci first.`);
  process.exit(1);
}

const build = spawnSync(process.execPath, [npmCli, "run", "tauri", "build", "--", "--no-bundle", "--config", "src-tauri/tauri.e2e.conf.json", "--", "--features", "e2e"], {
  cwd: root,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(completedStatus("Release performance application build", build));

const executable = `src-tauri/target/release/recallstack${process.platform === "win32" ? ".exe" : ""}`;
const result = spawnSync(process.execPath, [wdioCli, "run", "tests/e2e/wdio.performance.conf.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    RECALLSTACK_E2E_BINARY: executable,
    RECALLSTACK_PERF_OUTPUT: resolve(root, "performance-results", `${platform}.json`),
  },
  stdio: "inherit",
});
process.exit(completedStatus("Release performance desktop driver", result));

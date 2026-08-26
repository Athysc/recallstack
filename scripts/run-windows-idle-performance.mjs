import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") {
  console.error("The long idle/resume regression test must run on Windows with WebView2.");
  process.exit(1);
}

const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) {
  console.error("npm_execpath does not point to npm's CLI; run this through npm.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [npmCli, "run", "test:release:performance"], {
  cwd: process.cwd(),
  env: { ...process.env, RECALLSTACK_WINDOWS_IDLE_E2E: "1" },
  stdio: "inherit",
});
process.exit(result.status ?? 1);

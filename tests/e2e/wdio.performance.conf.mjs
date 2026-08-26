import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as base } from "./wdio.conf.mjs";

const workspace = resolve(import.meta.dirname, ".workspace");

export const config = {
  ...base,
  specs: [resolve(import.meta.dirname, "specs/release-performance.e2e.mjs")],
  services: [base.services[0]],
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: process.env.RECALLSTACK_WINDOWS_IDLE_E2E === "1" ? 600_000 : 180_000,
  },
  onPrepare() {
    base.onPrepare();
    for (let folder = 0; folder < 20; folder += 1) {
      const directory = resolve(workspace, "Data/personal/performance", `batch-${String(folder).padStart(2, "0")}`);
      mkdirSync(directory, { recursive: true });
      for (let note = 0; note < 50; note += 1) {
        writeFileSync(resolve(directory, `Synthetic ${folder}-${note}.md`), `# Synthetic ${folder}-${note}\n\n#performance\n\n${"release timing text ".repeat(40)}\n`);
      }
    }
  },
};

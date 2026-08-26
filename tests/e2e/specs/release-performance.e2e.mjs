import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const workspacePath = resolve(import.meta.dirname, "../.workspace");
const outputPath = resolve(process.env.RECALLSTACK_PERF_OUTPUT || `performance-results/${process.platform}.json`);
const version = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8")).version;
const rounded = value => value == null ? null : Math.round(value * 10) / 10;
const runWindowsIdleTest = process.platform === "win32" && process.env.RECALLSTACK_WINDOWS_IDLE_E2E === "1";
const windowsIdleTest = runWindowsIdleTest ? it : it.skip;

async function waitForVisible(selector) {
  const element = await $(selector);
  await element.waitForDisplayed();
  return element;
}

describe("RecallStack release performance", () => {
  it("records startup and primary navigation timings", async () => {
    await browser.execute(() => localStorage.clear());
    await browser.refresh();
    await waitForVisible("#welcome");
    const shellReadyMs = await browser.execute(() => performance.getEntriesByName("recallstack:shell-ready").at(-1)?.startTime ?? null);

    await browser.execute(path => {
      localStorage.clear();
      localStorage.setItem("recallstack-desktop-workspace-path", path);
    }, workspacePath);
    await browser.refresh();
    await waitForVisible("#app");
    const workspaceOpenMs = await browser.execute(() => performance.getEntriesByName("recallstack:workspace-ui-open").at(-1)?.duration ?? null);
    const folderRenameMs = await browser.execute(async () => {
      const started = performance.now();
      await window.__recallstackNative.renamePath("Data/personal/performance", "Data/personal/performance-renamed");
      await window.__recallstackNative.renamePath("Data/personal/performance-renamed", "Data/personal/performance");
      return (performance.now() - started) / 2;
    });

    const noteOpenMs = await browser.execute(async () => {
      const buttons = [...document.querySelectorAll("#nav-row-1 button")];
      buttons.find(button => button.textContent?.includes("project"))?.click();
      while (![...document.querySelectorAll("#nav-row-2 button")].some(button => button.textContent?.includes("notes"))) {
        await new Promise(resolveFrame => requestAnimationFrame(resolveFrame));
      }
      [...document.querySelectorAll("#nav-row-2 button")].find(button => button.textContent?.includes("notes"))?.click();
      while (![...document.querySelectorAll("#file-grid .file-card")].some(card => card.textContent?.includes("Welcome Note"))) {
        await new Promise(resolveFrame => requestAnimationFrame(resolveFrame));
      }
      const card = [...document.querySelectorAll("#file-grid .file-card")].find(item => item.textContent?.includes("Welcome Note"));
      const started = performance.now();
      card.click();
      while (document.querySelector("#editor-view")?.classList.contains("hidden") || !document.querySelector("#md-editor .cm-editor")) {
        await new Promise(resolveFrame => requestAnimationFrame(resolveFrame));
      }
      return performance.now() - started;
    });

    const outputsOpenMs = await browser.execute(async () => {
      const outputButton = document.querySelector("#btn-outputs-top");
      if (!outputButton) throw new Error("Outputs header button was not rendered");
      const started = performance.now();
      outputButton.click();
      while (document.querySelector("#list-heading")?.textContent?.trim() !== "reports" || !document.querySelector("#file-grid .file-card")) {
        await new Promise(resolveFrame => requestAnimationFrame(resolveFrame));
      }
      return performance.now() - started;
    });

    const snapshot = await browser.execute(() => window.__recallstackNative.performanceSnapshot());
    const metrics = {
      version,
      recordedAt: new Date().toISOString(),
      platform: process.platform,
      fixtureNotes: 1003,
      shellReadyMs: rounded(shellReadyMs),
      workspaceOpenMs: rounded(workspaceOpenMs),
      folderRenameMs: rounded(folderRenameMs),
      noteOpenMs: rounded(noteOpenMs),
      outputsOpenMs: rounded(outputsOpenMs),
      transferredBytes: snapshot.transferredBytes,
      calls: snapshot.calls,
    };
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(metrics, null, 2)}\n`);

    expect(shellReadyMs).toBeLessThan(1500);
    expect(workspaceOpenMs).toBeLessThan(2500);
    expect(folderRenameMs).toBeLessThan(1000);
    expect(noteOpenMs).toBeLessThan(1500);
    expect(outputsOpenMs).toBeLessThan(1000);
  });

  windowsIdleTest("stays responsive after a suspended watcher burst", async function () {
    const idleMs = Number(process.env.RECALLSTACK_WINDOWS_IDLE_MS || 360_000);
    this.timeout(idleMs + 180_000);
    await browser.execute(path => {
      localStorage.clear();
      localStorage.setItem("recallstack-desktop-workspace-path", path);
    }, workspacePath);
    await browser.refresh();
    await waitForVisible("#app");

    await browser.tauri.execute(async ({ core }) => {
      await core.invoke("plugin:window|minimize", { label: "main" });
    });
    await new Promise(resolveIdle => setTimeout(resolveIdle, idleMs));

    // Mutate enough files after WebView2 has had time to suspend the hidden
    // renderer to create a realistic native-watcher burst on resume.
    const changedAt = new Date().toISOString();
    for (let folder = 0; folder < 5; folder += 1) {
      for (let note = 0; note < 50; note += 1) {
        const path = resolve(workspacePath, "Data/personal/performance", `batch-${String(folder).padStart(2, "0")}`, `Synthetic ${folder}-${note}.md`);
        writeFileSync(path, `# Synthetic ${folder}-${note}\n\n#performance\n\nChanged while hidden at ${changedAt}\n`);
      }
    }
    await new Promise(resolveWatcher => setTimeout(resolveWatcher, 2_000));

    const restoreStarted = Date.now();
    await browser.tauri.execute(async ({ core }) => {
      await core.invoke("plugin:window|unminimize", { label: "main" });
    });
    await browser.execute(() => {
      const input = document.querySelector("#search-input");
      if (!(input instanceof HTMLInputElement)) throw new Error("Search input is unavailable after resume");
      input.focus();
      input.value = "resume responsiveness";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const firstInputMs = Date.now() - restoreStarted;

    await browser.waitUntil(async () => {
      const snapshot = await browser.execute(() => window.__recallstackNative.performanceSnapshot());
      return !snapshot.watcher || snapshot.watcher.pendingWorkspaces === 0;
    }, { timeout: 30_000, timeoutMsg: "watcher invalidations did not drain after resume" });

    const snapshot = await browser.execute(() => window.__recallstackNative.performanceSnapshot());
    expect(firstInputMs).toBeLessThan(1_500);
    expect(snapshot.watcher.receivedChanges).toBeGreaterThan(0);
    expect(snapshot.watcher.deliveredBatches).toBeLessThanOrEqual(snapshot.watcher.receivedBatches);
  });
});

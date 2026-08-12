import "./ui/styles/index.css";
import { prepareRuntimeDependencies, reportBootstrapFailure } from "./app/bootstrap";
import { installWorkspaceWatcher } from "./services/watcher";

async function start(): Promise<void> {
  const buildMode = (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE;
  if (buildMode === "e2e") {
    await import("@wdio/tauri-plugin");
  }
  // Install native workspace services before the application controller starts.
  await import("./services/desktop-bridge");
  prepareRuntimeDependencies();
  installWorkspaceWatcher();
  await import("./app/recallstack-runtime");
}

void start().catch(reportBootstrapFailure);

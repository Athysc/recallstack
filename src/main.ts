import "./ui/styles/index.css";
import { prepareRuntimeDependencies, reportBootstrapFailure } from "./app/bootstrap";
import { installWorkspaceWatcher } from "./services/watcher";

async function start(): Promise<void> {
  // The bridge must install the desktop filesystem adapter before the legacy-
  // compatible controller evaluates its capability checks.
  await import("./services/desktop-bridge");
  prepareRuntimeDependencies();
  installWorkspaceWatcher();
  await import("./app/recallstack-runtime");
}

void start().catch(reportBootstrapFailure);

export const PREFERENCE_KEYS = Object.freeze({
  activeWorkspace: "pkm-active-workspace",
  allTasksEnabled: "pkm-all-tasks-enabled",
  appTitle: "pkm-app-title",
  collapseDefault: "pkm-collapse-default",
  cursorLoadPosition: "pkm-cursor-load-pos",
  loadRemoteMedia: "pkm-load-remote-media",
  lineNumbers: "pkm-line-numbers",
  onlineDependencies: "pkm-online-deps",
  showSystemFolders: "pkm-show-system-folders",
  sqlSource: "pkm-sql-source",
  wordWrap: "pkm-word-wrap",
  workingPaneVisible: "pkm-working-pane-visible",
  workingPaneLayout: "pkm-working-pane-layout",
  workingPaneBottomRatio: "pkm-working-pane-bottom-ratio",
  workingPaneWidths: "pkm-working-pane-widths",
  workingShowCompleted: "pkm-working-show-completed",
  workingSort: "pkm-working-sort",
  workspaceRootPath: "recallstack-workspace-root-path",
});

export type WorkspacePreference = "theme" | "nav1-mode" | "nav2-mode" | "all-tasks-mode" | "last-view";

export function workspacePreferenceKey(kind: WorkspacePreference, workspace: string): string {
  return `pkm-${kind}-${workspace}`;
}

export function draftPreferenceKey(workspace: string | null, path: string | null): string {
  return `pkm-draft:${workspace || "__no_workspace__"}:${path || "__new__"}`;
}

export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function preferenceIsEnabled(value: string | null, defaultEnabled = false): boolean {
  return value === null ? defaultEnabled : value === "on";
}

export function writePreference(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function removePreference(key: string): void {
  try { localStorage.removeItem(key); } catch { /* storage may be unavailable */ }
}

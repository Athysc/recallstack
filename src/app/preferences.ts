export const PREFERENCE_KEYS = Object.freeze({
  activeWorkspace: "pkm-active-workspace",
  appTitle: "pkm-app-title",
  collapseDefault: "pkm-collapse-default",
  contentZoom: "pkm-content-zoom",
  cursorLoadPosition: "pkm-cursor-load-pos",
  loadRemoteMedia: "pkm-load-remote-media",
  showSystemFolders: "pkm-show-system-folders",
  wordWrap: "pkm-word-wrap",
  workspaceRootPath: "recallstack-workspace-root-path",
  outputsFolderPath: "recallstack-outputs-folder-path",
  extraDataFolderPath: "recallstack-extra-data-folder-path",
  externalThemePath: "recallstack-external-theme-path",
  taskListingSort: "pkm-task-listing-sort",
  workingListingSort: "pkm-working-listing-sort",
  notesListingSort: "pkm-notes-listing-sort",
});

export type WorkspacePreference = "theme" | "nav1-mode" | "nav2-mode" | "last-view";

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

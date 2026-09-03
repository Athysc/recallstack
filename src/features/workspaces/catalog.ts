import { getDirHandle, listDirs, type NamedDirectory } from "../../services/filesystem.ts";

export interface WorkspaceDirectory extends NamedDirectory {
  dbPrefix: string;
  topLevelDirs?: NamedDirectory[];
  // Set for the user-configured Extra Data Folder: an arbitrary directory on
  // disk surfaced as the first workspace. Its files live outside Data/, so all
  // reads/writes route through the external FS bridge and it is left out of the
  // search index. `extraPath` is its absolute OS path (native mode).
  isExtraData?: boolean;
  extraPath?: string;
}

// The global tasks / dailylogs roots. They live directly under `Data/`, as
// siblings of the workspace folders, and are shared by every workspace — never
// surfaced as workspaces of their own.
export const GLOBAL_TASKS_DIRS: ReadonlySet<string> = new Set(["tasks", "dailylogs"]);

// Creates the global `Data/tasks` and `Data/dailylogs` roots if missing.
export async function ensureGlobalTasksRoots(dataHandle: FileSystemDirectoryHandle): Promise<void> {
  for (const name of GLOBAL_TASKS_DIRS) {
    try {
      await dataHandle.getDirectoryHandle(name, { create: true });
    } catch (error) {
      // Unit-test directory mocks may not implement the create option. Real
      // FileSystemDirectoryHandle implementations create the folder here.
      if (!error || typeof error !== "object" || !("name" in error) || error.name !== "NotFoundError") throw error;
    }
  }
}

export async function discoverWorkspaces(root: FileSystemDirectoryHandle): Promise<{
  workspaces: WorkspaceDirectory[];
  dataHandle: FileSystemDirectoryHandle | null;
}> {
  const workspaces: WorkspaceDirectory[] = [];
  let dataHandle: FileSystemDirectoryHandle | null = null;
  try {
    dataHandle = await getDirHandle(root, ["Data"]);
    await ensureGlobalTasksRoots(dataHandle);
    const dataWorkspaces = await listDirs(dataHandle);
    for (const workspace of dataWorkspaces) {
      if (GLOBAL_TASKS_DIRS.has(workspace.name.toLowerCase())) continue;
      workspaces.push({
        ...workspace,
        dbPrefix: `Data/${workspace.name}/`,
      });
    }
  } catch {
    dataHandle = null;
  }
  for (const name of ["ai-team", "openbrain", "shared", "openbrain-shared"]) {
    try {
      workspaces.push({ name, handle: await root.getDirectoryHandle(name), dbPrefix: `${name}/` });
    } catch {
      // Optional workspace folder.
    }
  }
  if (!workspaces.length && dataHandle) {
    workspaces.push({ name: "Data", handle: dataHandle, dbPrefix: "Data/" });
  }
  return { workspaces, dataHandle };
}

export function selectInitialWorkspace(
  workspaces: WorkspaceDirectory[],
  preferredName: string | null,
  showSystemFolders: boolean,
  systemWorkspaceNames: ReadonlySet<string>,
): WorkspaceDirectory | null {
  let selected = workspaces.find(workspace => workspace.name === preferredName) || workspaces[0] || null;
  if (selected && !showSystemFolders && systemWorkspaceNames.has(selected.name)) {
    selected = workspaces.find(workspace => !systemWorkspaceNames.has(workspace.name)) || selected;
  }
  return selected;
}

export interface WorkspaceNavigationPreferences {
  row1Mode: "buttons" | "combo";
  row2Mode: "buttons" | "combo";
}

export function readWorkspaceNavigationPreferences(
  storage: Pick<Storage, "getItem">,
  workspace: string,
): WorkspaceNavigationPreferences {
  return {
    row1Mode: storage.getItem(`pkm-nav1-mode-${workspace}`) === "combo" ? "combo" : "buttons",
    row2Mode: storage.getItem(`pkm-nav2-mode-${workspace}`) === "combo" ? "combo" : "buttons",
  };
}

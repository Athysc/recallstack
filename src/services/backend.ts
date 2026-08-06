import { invoke } from "@tauri-apps/api/core";
import type { Entry, HealthReport, Note, SearchResult, WorkspaceSummary } from "../app/types";

export const backend = {
  workspaceSummary: () => invoke<WorkspaceSummary | null>("workspace_summary"),
  setWorkspace: (path: string) => invoke<WorkspaceSummary>("set_workspace", { path }),
  recentWorkspaces: () => invoke<WorkspaceSummary[]>("recent_workspaces"),
  listEntries: (path?: string, recursive = false) => invoke<Entry[]>("list_entries", { path, recursive }),
  readNote: (path: string) => invoke<Note>("read_note", { path }),
  writeNote: (path: string, content: string) => invoke<void>("write_note", { path, content }),
  createNote: (path: string, content: string) => invoke<Note>("create_note", { path, content }),
  moveToTrash: (path: string) => invoke<string>("move_to_trash", { path }),
  rebuildIndex: () => invoke<number>("rebuild_index"),
  search: (query: string) => invoke<SearchResult[]>("search_notes", { query }),
  reveal: (path?: string) => invoke<void>("reveal_path", { path }),
  backup: () => invoke<{ path: string; files: number }>("backup_workspace"),
  health: () => invoke<HealthReport>("check_workspace"),
};

interface RecallStackNativeBridge {
  active: true;
  saveWorkspaceHandle(): Promise<void>;
  loadWorkspaceHandle(): Promise<FileSystemDirectoryHandle | null>;
  search(query: string, prefix?: string): Promise<Array<{ path: string; name: string; snippet: string }>>;
  recentWorkspaces(): Promise<Array<{ id: string; path: string; name: string }>>;
  removeRecentWorkspace(path: string): Promise<void>;
  openWorkspacePath(path: string): Promise<FileSystemDirectoryHandle>;
  workspaceRootPath(): string | null;
  writeClipboardText(text: string): Promise<void>;
  revealPath(path?: string | null): Promise<void>;
  revealWorkspace(): Promise<void>;
  knowledgeSearch(query: string, prefix?: string, limit?: number, offset?: number): Promise<{ results: Array<Record<string, any>>; total: number; offset: number; hasMore: boolean }>;
  indexedNotes(prefix?: string): Promise<Array<{ path: string; name: string; title: string; tags: string[]; kind: string; modifiedAt: number }>>;
  backlinks(path: string): Promise<Array<{ sourcePath: string; sourceTitle: string; anchor?: string | null; kind: string }>>;
  listSavedSearches(): Promise<Array<{ id: number; name: string; query: string; sortOrder: number }>>;
  saveSearch(name: string, query: string): Promise<Record<string, unknown>>;
  deleteSavedSearch(id: number): Promise<boolean>;
  readText(path: string): Promise<{ text: string; version: string }>;
  writeText(path: string, text: string, expectedVersion?: string | null): Promise<string>;
  readPortableText(name: "readme.md" | "changes.md" | "theme.json"): Promise<string | null>;
  trash(path: string): Promise<Record<string, unknown>>;
  listTrash(): Promise<Array<Record<string, unknown>>>;
  restoreTrash(id: string, restoreAs?: string | null): Promise<Record<string, unknown>>;
  emptyTrash(): Promise<number>;
  listVersions(path?: string | null): Promise<Array<Record<string, unknown>>>;
  restoreVersion(id: string): Promise<Record<string, unknown>>;
  saveDraft(path: string, text: string): Promise<void>;
  loadDraft(path: string): Promise<string | null>;
  clearDraft(path: string): Promise<void>;
  backup(destination?: string | null, includeCache?: boolean): Promise<Record<string, unknown>>;
  chooseBackupDestination(): Promise<string | null>;
  chooseBackupFile(): Promise<string | null>;
  cancelBackup(): Promise<void>;
  verifyBackup(path: string): Promise<Record<string, unknown>>;
  restoreBackupDryRun(path: string): Promise<Record<string, unknown>>;
  checkWorkspace(): Promise<Record<string, unknown>>;
  rebuildIndex(): Promise<number>;
  cancelIndex(): Promise<void>;
  indexHealth(): Promise<Record<string, unknown>>;
  gitStatus(): Promise<Record<string, unknown>>;
  tasks(prefix?: string): Promise<Array<Record<string, unknown>>>;
  fileHandle(path: string, metadata?: Record<string, unknown>): FileSystemFileHandle;
  directoryHandle(path: string): FileSystemDirectoryHandle;
  listFilesRecursive(path: string): Promise<Array<{ name: string; path: string; isDir: boolean; size: number; modifiedAt: number; version: string }>>;
  referencedAssets(path: string): Promise<string[]>;
  renamePath(from: string, to: string): Promise<Record<string, unknown>>;
  assetUrl(path: string): string;
  performanceSnapshot(): Record<string, unknown>;
  close(): Promise<void>;
  closeApp(): Promise<void>;
}

interface Window {
  __TAURI__?: Record<string, any>;
  __TAURI_INTERNALS__?: Record<string, unknown>;
  __recallstackNative?: RecallStackNativeBridge;
  showDirectoryPicker(options?: { mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
  queryPermission(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

interface Navigator {
  userAgentData?: { platform?: string };
}

declare const marked: typeof import("marked").marked;
declare const hljs: typeof import("highlight.js").default;
declare const mermaid: typeof import("mermaid").default;

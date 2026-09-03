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
  readClipboardImage(): Promise<{ format: 'encoded' | 'rgba'; width: number; height: number; bytes: number[] } | null>;
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
  saveDraft(path: string, text: string): Promise<void>;
  loadDraft(path: string): Promise<string | null>;
  clearDraft(path: string): Promise<void>;
  backup(destination?: string | null, includeCache?: boolean): Promise<Record<string, unknown>>;
  chooseBackupDestination(): Promise<string | null>;
  chooseBackupFile(): Promise<string | null>;
  chooseThemeFile(): Promise<string | null>;
  cancelBackup(): Promise<void>;
  verifyBackup(path: string): Promise<Record<string, unknown>>;
  restoreBackupDryRun(path: string): Promise<Record<string, unknown>>;
  checkWorkspace(): Promise<Record<string, unknown>>;
  chooseExternalMarkdownFiles(): Promise<string[]>;
  externalStat(path: string): Promise<{ name: string; size: number; modifiedAt: number }>;
  externalReadText(path: string): Promise<string>;
  externalRead(path: string): Promise<number[]>;
  externalWriteText(path: string, text: string): Promise<void>;
  externalRename(from: string, to: string): Promise<void>;
  chooseOutputsFolder(): Promise<string | null>;
  chooseExtraDataFolder(): Promise<string | null>;
  chooseSystemFolder(): Promise<string | null>;
  externalFileHandle(path: string, metadata?: Record<string, unknown>): FileSystemFileHandle;
  externalDirectoryHandle(path: string): FileSystemDirectoryHandle;
  listExternalFilesRecursive(path: string): Promise<Array<{ name: string; path: string; isDir: boolean; size: number; modifiedAt: number; version: string }>>;
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
  __recallstackWatcherDiagnostics?: {
    receivedBatches: number;
    deliveredBatches: number;
    receivedChanges: number;
    deliveredChanges: number;
    queuedWhileHidden: number;
    sequenceGaps: number;
    overflows: number;
    reconciliations: number;
    pendingWorkspaces: number;
    lastFlushAt: number;
    backgroundedAt: number;
    lastBackgroundDurationMs: number;
    maxEventDeliveryDelayMs: number;
  };
  showDirectoryPicker(options?: { mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
  // Standard Chromium File System Access API — used for the "Open / Import
  // Files" Browse button in browser (non-Tauri) mode. Not yet in TS's DOM lib.
  showOpenFilePicker?(options?: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }): Promise<FileSystemFileHandle[]>;
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
  queryPermission(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

interface DataTransferItem {
  // Standard Chromium API for drag-and-drop of real files — used so a file
  // dropped into "Open / Import Files" gets a real, writable
  // FileSystemFileHandle in browser mode, consistent with the Browse button.
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}

interface Navigator {
  userAgentData?: { platform?: string };
}

declare const marked: typeof import("marked").marked;
declare const hljs: typeof import("highlight.js").default;
declare const mermaid: typeof import("mermaid").default;

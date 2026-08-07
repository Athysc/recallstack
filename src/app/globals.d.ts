interface RecallStackNativeBridge {
  active: true;
  saveWorkspaceHandle(): Promise<void>;
  loadWorkspaceHandle(): Promise<FileSystemDirectoryHandle | null>;
  search(query: string, prefix?: string): Promise<Array<{ path: string; name: string; snippet: string }>>;
  readText(path: string): Promise<{ text: string; version: string }>;
  writeText(path: string, text: string, expectedVersion?: string | null): Promise<string>;
  readPortableText(name: "readme.md" | "changes.md" | "theme.json"): Promise<string | null>;
  tasks(prefix?: string): Promise<Array<Record<string, unknown>>>;
  fileHandle(path: string, metadata?: Record<string, unknown>): FileSystemFileHandle;
  performanceSnapshot(): Record<string, unknown>;
  close(): Promise<void>;
}

interface Window {
  __TAURI__?: Record<string, any>;
  __TAURI_INTERNALS__?: Record<string, unknown>;
  __recallstackNative?: RecallStackNativeBridge;
}

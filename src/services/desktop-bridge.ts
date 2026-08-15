import { assertPortableName } from "./portable-names";

(() => {
  'use strict';

  interface NativeMetadata {
    name?: string;
    path?: string;
    isDir?: boolean;
    size?: number;
    modifiedAt?: number;
  }

  interface NativeWriteCommand {
    type: 'write';
    data: string | Blob | ArrayBuffer | ArrayBufferView;
  }

  type NativeHandle = NativeFileHandle | NativeDirectoryHandle;

  if (!window.__TAURI_INTERNALS__ || !window.__TAURI__?.core?.invoke) return;

  const rawInvoke = window.__TAURI__.core.invoke as (command: string, args?: Record<string, unknown>) => Promise<any>;
  const metrics: {
    startedAt: number;
    calls: Record<string, { count: number; durationMs: number }>;
    transferredBytes: number;
  } = { startedAt: performance.now(), calls: {}, transferredBytes: 0 };
  let indexState = 'unknown';
  const indexWaiters = new Set<() => void>();
  async function invoke<T = any>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const started = performance.now();
    const entry = metrics.calls[command] ||= { count: 0, durationMs: 0 };
    entry.count += 1;
    try {
      const result = await rawInvoke(command, args);
      if (Array.isArray(result) && (result.length === 0 || typeof result[0] === 'number')) {
        metrics.transferredBytes += result.length;
      } else if (typeof result === 'string') {
        metrics.transferredBytes += result.length * 2;
      }
      return result;
    } finally {
      entry.durationMs += performance.now() - started;
    }
  }
  performance.mark('recallstack:desktop-shim-ready');
  const savedPathKey = 'recallstack-desktop-workspace-path';
  const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');
  const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || 'Workspace';

  class NativeFileHandle {
    readonly kind = 'file' as const;
    readonly path: string;
    readonly name: string;
    readonly metadata: NativeMetadata;

    constructor(path: string, metadata: NativeMetadata = {}) {
      this.path = path;
      this.name = metadata.name || baseName(path);
      this.metadata = metadata;
    }

    async getFile() {
      if (isTextFile(this.name)) return new NativeTextFile(this.path, this.name, this.metadata);
      const bytes = await invoke('fs_read', { path: this.path });
      return new File([new Uint8Array(bytes)], this.name, {
        type: mimeType(this.name),
        lastModified: this.metadata.modifiedAt || Date.now(),
      });
    }

    async createWritable() {
      return new NativeWritable(this.path);
    }

    async isSameEntry(other: NativeHandle) {
      return other?.kind === 'file' && other.path === this.path;
    }

    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
  }

  class NativeTextFile {
    readonly path: string;
    readonly name: string;
    readonly type: string;
    readonly size: number;
    readonly lastModified: number;

    constructor(path: string, name: string, metadata: NativeMetadata = {}) {
      this.path = path;
      this.name = name;
      this.type = mimeType(name);
      this.size = metadata.size || 0;
      this.lastModified = metadata.modifiedAt || Date.now();
    }

    async text() { return invoke('fs_read_text', { path: this.path }); }
    async arrayBuffer() { return new TextEncoder().encode(await this.text()).buffer; }
  }

  class NativeWritable {
    readonly path: string;
    private parts: Array<string | Uint8Array> = [];
    private textOnly = true;
    private closed = false;

    constructor(path: string) { this.path = path; }

    async write(value: string | Blob | ArrayBuffer | ArrayBufferView | NativeWriteCommand): Promise<void> {
      if (this.closed) throw new DOMException('Writable is closed', 'InvalidStateError');
      if (typeof value === 'string') this.parts.push(value);
      else if (value instanceof Blob) { this.textOnly = false; this.parts.push(new Uint8Array(await value.arrayBuffer())); }
      else if (value instanceof ArrayBuffer) { this.textOnly = false; this.parts.push(new Uint8Array(value)); }
      else if (ArrayBuffer.isView(value)) { this.textOnly = false; this.parts.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)); }
      else if ('type' in value && value.type === 'write') return this.write(value.data);
      else throw new TypeError('Unsupported file write value');
    }

    async close() {
      if (this.closed) return;
      if (this.textOnly) {
        await invoke('fs_write_text', { path: this.path, text: this.parts.join('') });
        this.closed = true;
        return;
      }
      const binaryParts = this.parts.map(part => typeof part === 'string' ? new TextEncoder().encode(part) : part);
      const size = binaryParts.reduce((total, part) => total + part.byteLength, 0);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of binaryParts) { bytes.set(part, offset); offset += part.byteLength; }
      await invoke('fs_write', { path: this.path, bytes: Array.from(bytes) });
      this.closed = true;
    }
  }

  class NativeDirectoryHandle {
    readonly kind = 'directory' as const;
    readonly path: string;
    readonly name: string;

    constructor(path = '', name: string | null = null) {
      this.path = path;
      this.name = name || baseName(path);
    }

    async *values() {
      const entries = await invoke<NativeMetadata[]>('fs_list', { path: this.path });
      for (const entry of entries) {
        yield entry.isDir
          ? new NativeDirectoryHandle(entry.path || join(this.path, entry.name || ''), entry.name)
          : new NativeFileHandle(entry.path || join(this.path, entry.name || ''), entry);
      }
    }

    async *entries() {
      for await (const entry of this.values()) yield [entry.name, entry];
    }

    async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
      validateName(name);
      const path = join(this.path, name);
      const metadata = await invoke<NativeMetadata | null>('fs_stat', { path });
      if (!metadata && options.create) await invoke('fs_create_dir', { path });
      else if (!metadata) throw new DOMException(`Directory not found: ${name}`, 'NotFoundError');
      else if (!metadata.isDir) throw new DOMException(`Not a directory: ${name}`, 'TypeMismatchError');
      return new NativeDirectoryHandle(path, name);
    }

    async getFileHandle(name: string, options: { create?: boolean } = {}) {
      validateName(name);
      const path = join(this.path, name);
      let metadata = await invoke<NativeMetadata | null>('fs_stat', { path });
      if (!metadata && options.create) {
        await invoke('fs_write', { path, bytes: [] });
        metadata = await invoke('fs_stat', { path });
      } else if (!metadata) throw new DOMException(`File not found: ${name}`, 'NotFoundError');
      if (metadata?.isDir) throw new DOMException(`Not a file: ${name}`, 'TypeMismatchError');
      return new NativeFileHandle(path, metadata || { name, path });
    }

    async removeEntry(name: string, options: { recursive?: boolean } = {}) {
      validateName(name);
      return invoke('fs_remove', { path: join(this.path, name), recursive: !!options.recursive });
    }

    async isSameEntry(other: NativeHandle) {
      return other?.kind === 'directory' && other.path === this.path;
    }

    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
  }

  // ── External directory access (Outputs folder) ──────────────────────────
  // Parallels NativeFileHandle/NativeWritable/NativeDirectoryHandle above,
  // but every operation goes through the external_fs_* commands instead of
  // the workspace-scoped fs_* ones — see validate_external_directory() /
  // validate_external_file() in src-tauri/src/commands/bridge.rs. Used only
  // for the Outputs folder, which the user can point at any directory on
  // disk via chooseOutputsFolder() below, not just one inside the open
  // workspace. Paths on these classes are always absolute OS paths.

  class NativeExternalTextFile {
    readonly path: string;
    readonly name: string;
    readonly type: string;
    readonly size: number;
    readonly lastModified: number;

    constructor(path: string, name: string, metadata: NativeMetadata = {}) {
      this.path = path;
      this.name = name;
      this.type = mimeType(name);
      this.size = metadata.size || 0;
      this.lastModified = metadata.modifiedAt || Date.now();
    }

    async text() { return invoke('external_fs_read_text', { path: this.path }); }
    async arrayBuffer() { return new TextEncoder().encode(await this.text()).buffer; }
  }

  class NativeExternalFileHandle {
    readonly kind = 'file' as const;
    readonly path: string;
    readonly name: string;
    readonly metadata: NativeMetadata;

    constructor(path: string, metadata: NativeMetadata = {}) {
      this.path = path;
      this.name = metadata.name || baseName(path);
      this.metadata = metadata;
    }

    async getFile() {
      if (isTextFile(this.name)) return new NativeExternalTextFile(this.path, this.name, this.metadata);
      const bytes = await invoke('external_fs_read', { path: this.path });
      return new File([new Uint8Array(bytes)], this.name, {
        type: mimeType(this.name),
        lastModified: this.metadata.modifiedAt || Date.now(),
      });
    }

    async createWritable() {
      return new NativeExternalWritable(this.path);
    }

    async isSameEntry(other: NativeHandle) {
      return other?.kind === 'file' && other.path === this.path;
    }

    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
  }

  // Only text writes are needed: Outputs files are always edited in place as
  // Markdown (see currentOutputsFh.createWritable() in recallstack-runtime.ts),
  // and — unlike the workspace-scoped NativeWritable — external_fs_write_text
  // requires the target to already exist, which every Outputs file does since
  // it was only ever reached by listing an existing folder.
  class NativeExternalWritable {
    readonly path: string;
    private parts: string[] = [];
    private closed = false;

    constructor(path: string) { this.path = path; }

    async write(value: string | NativeWriteCommand): Promise<void> {
      if (this.closed) throw new DOMException('Writable is closed', 'InvalidStateError');
      if (typeof value === 'string') { this.parts.push(value); return; }
      if (value && typeof value === 'object' && 'type' in value && value.type === 'write' && typeof value.data === 'string') {
        return this.write(value.data);
      }
      throw new TypeError('Only text writes are supported for the outputs folder');
    }

    async close() {
      if (this.closed) return;
      await invoke('external_fs_write_text', { path: this.path, text: this.parts.join('') });
      this.closed = true;
    }
  }

  class NativeExternalDirectoryHandle {
    readonly kind = 'directory' as const;
    readonly path: string;
    readonly name: string;

    constructor(path: string, name: string | null = null) {
      this.path = path;
      this.name = name || baseName(path);
    }

    async *values() {
      const entries = await invoke<NativeMetadata[]>('external_fs_list', { path: this.path });
      for (const entry of entries) {
        yield entry.isDir
          ? new NativeExternalDirectoryHandle(entry.path || join(this.path, entry.name || ''), entry.name)
          : new NativeExternalFileHandle(entry.path || join(this.path, entry.name || ''), entry);
      }
    }

    async *entries() {
      for await (const entry of this.values()) yield [entry.name, entry];
    }

    async removeEntry(name: string) {
      validateName(name);
      return invoke('external_fs_remove', { path: join(this.path, name) });
    }

    async isSameEntry(other: NativeHandle) {
      return other?.kind === 'directory' && other.path === this.path;
    }

    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
  }

  function validateName(name: string) {
    assertPortableName(name);
  }

  function mimeType(name: string) {
    const extension = name.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = { md: 'text/markdown', txt: 'text/plain', html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', mp3: 'audio/mpeg', mp4: 'video/mp4' };
    return extension ? types[extension] || 'application/octet-stream' : 'application/octet-stream';
  }

  function isTextFile(name: string) {
    // Markdown is consumed as text throughout RecallStack. Other text-like files
    // may be passed to URL.createObjectURL(), which requires a real File/Blob.
    return /\.md$/i.test(name);
  }

  async function activateWorkspace(path: string): Promise<NativeDirectoryHandle> {
    performance.mark('recallstack:workspace-open-start');
    indexState = 'indexing';
    const summary = await invoke<{ path: string; name: string }>('set_workspace', { path });
    localStorage.setItem(savedPathKey, summary.path);
    performance.mark('recallstack:workspace-native-ready');
    performance.measure('recallstack:workspace-native-open', 'recallstack:workspace-open-start', 'recallstack:workspace-native-ready');
    return new NativeDirectoryHandle('', summary.name);
  }

  window.showDirectoryPicker = async () => {
    let path;
    if (typeof window.__TAURI__?.dialog?.open === 'function') {
      path = await window.__TAURI__.dialog.open({
        directory: true,
        multiple: false,
        title: 'Open RecallStack workspace',
      });
    } else {
      path = await invoke('pick_workspace');
    }
    if (!path) throw new DOMException('The user aborted a request', 'AbortError');
    if (typeof path !== 'string') path = path.path || String(path);
    return activateWorkspace(path) as unknown as FileSystemDirectoryHandle;
  };

  window.__recallstackNative = {
    active: true,
    async saveWorkspaceHandle() {},
    async loadWorkspaceHandle() {
      const path = localStorage.getItem(savedPathKey);
      if (!path) return null;
      try { return await activateWorkspace(path) as unknown as FileSystemDirectoryHandle; }
      catch (error) { console.warn('Could not reopen RecallStack workspace', error); return null; }
    },
    // Absolute, OS-native workspace root path as returned by the Rust backend
    // (backslashes on Windows, forward slashes on macOS/Linux) — set whenever a
    // workspace is opened. This is the ground truth for reconstructing full file
    // paths; do not re-derive it from location.href or ask the user to type it.
    workspaceRootPath() { return localStorage.getItem(savedPathKey) || null; },
    // Writes plain text through Tauri's native clipboard-manager plugin instead of
    // navigator.clipboard.writeText(). On Linux, WebKitGTK's own clipboard bridge
    // logs a "Gdk-WARNING: Error writing selection data: Broken pipe" whenever a
    // clipboard-history tool (clipman, CopyQ, Klipper, ...) reads the selection —
    // the native plugin writes via X11/Wayland directly and sidesteps that path.
    writeClipboardText(text) { return invoke('plugin:clipboard-manager|write_text', { text }); },
    search(query, prefix = '') { return invoke('search_notes', { query, prefix }); },
    recentWorkspaces() { return invoke('recent_workspaces'); },
    removeRecentWorkspace(path) { return invoke('remove_recent_workspace', { path }); },
    openWorkspacePath(path) { return activateWorkspace(path) as unknown as Promise<FileSystemDirectoryHandle>; },
    revealPath(path = null) { return invoke('reveal_path', { path }); },
    revealWorkspace() { return invoke('open_workspace_folder'); },
    knowledgeSearch(query, prefix = '', limit = 80, offset = 0) { return invoke('search_knowledge', { query, prefix, limit, offset }); },
    indexedNotes(prefix = '') { return invoke('indexed_note_catalog', { prefix }); },
    backlinks(path) { return invoke('backlinks', { path }); },
    listSavedSearches() { return invoke('list_saved_searches'); },
    saveSearch(name, query) { return invoke('save_search', { name, query }); },
    deleteSavedSearch(id) { return invoke('delete_saved_search', { id }); },
    readText(path) { return invoke('fs_read_text_versioned', { path }); },
    writeText(path, text, expectedVersion = null) {
      return invoke('fs_write_text_versioned', { path, text, expectedVersion });
    },
    readPortableText(name) { return invoke('portable_read_text', { name }); },
    trash(path) { return invoke('trash_path', { path }); },
    listTrash() { return invoke('list_trash'); },
    restoreTrash(id, restoreAs = null) { return invoke('restore_trash', { id, restoreAs }); },
    emptyTrash() { return invoke('empty_trash'); },
    listVersions(path = null) { return invoke('list_versions', { path }); },
    restoreVersion(id) { return invoke('restore_version', { id }); },
    saveDraft(path, text) { return invoke('save_draft', { path, text }); },
    loadDraft(path) { return invoke('load_draft', { path }); },
    clearDraft(path) { return invoke('clear_draft', { path }); },
    backup(destination = null, includeCache = false) { return invoke('backup_workspace', { destination, includeCache }); },
    async chooseBackupDestination() {
      if (typeof window.__TAURI__?.dialog?.save !== 'function') return null;
      const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const value = await window.__TAURI__.dialog.save({
        title: 'Save verified RecallStack backup',
        defaultPath: `RecallStack-backup-${date}.zip`,
        filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
      });
      if (!value) return null;
      return typeof value === 'string' ? value : value.path || String(value);
    },
    async chooseBackupFile() {
      if (typeof window.__TAURI__?.dialog?.open !== 'function') return null;
      const value = await window.__TAURI__.dialog.open({ title: 'Choose a RecallStack backup to verify', multiple: false, directory: false, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
      if (!value) return null;
      return typeof value === 'string' ? value : value.path || String(value);
    },
    cancelBackup() { return invoke('cancel_backup'); },
    verifyBackup(path) { return invoke('verify_backup', { path }); },
    restoreBackupDryRun(path) { return invoke('restore_backup_dry_run', { path }); },
    checkWorkspace() { return invoke('check_workspace'); },
    // Open / Import Files: native multi-file picker filtered to Markdown, and the
    // external_fs_* commands that read/write an absolute OS path outside the
    // workspace (see bridge.rs) — used for "temporary" (edit-in-place) external tabs,
    // to pull source content for an "import into workspace" copy, and (externalRead)
    // to pull raw bytes for an asset dropped into the editor from outside the
    // workspace via the webview's onDragDropEvent (paths only, no in-memory bytes).
    async chooseExternalMarkdownFiles() {
      if (typeof window.__TAURI__?.dialog?.open !== 'function') return [];
      const value = await window.__TAURI__.dialog.open({
        title: 'Open or Import Markdown Files',
        multiple: true,
        directory: false,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!value) return [];
      const list = Array.isArray(value) ? value : [value];
      return list.map(item => (typeof item === 'string' ? item : item.path || String(item)));
    },
    externalStat(path) { return invoke('external_fs_stat', { path }); },
    externalReadText(path) { return invoke('external_fs_read_text', { path }); },
    externalRead(path) { return invoke('external_fs_read', { path }); },
    externalWriteText(path, text) { return invoke('external_fs_write_text', { path, text }); },
    // Outputs folder: a native "choose any folder" dialog (same dialog plugin
    // call as chooseBackupDestination()/chooseBackupFile() above, just with
    // directory:true) — no dedicated Rust command needed for the picking
    // itself. Once chosen, the folder is browsed/read/written/deleted through
    // externalDirectoryHandle()/externalFileHandle() below and the
    // external_fs_list*/external_fs_remove commands, since it's no longer
    // guaranteed to live inside the open workspace.
    async chooseOutputsFolder() {
      if (typeof window.__TAURI__?.dialog?.open !== 'function') return null;
      const value = await window.__TAURI__.dialog.open({ title: 'Choose Outputs Folder', directory: true, multiple: false });
      if (!value) return null;
      return typeof value === 'string' ? value : value.path || String(value);
    },
    rebuildIndex() { return invoke('rebuild_index'); },
    cancelIndex() { return invoke('cancel_index'); },
    indexHealth() { return invoke('index_health'); },
    gitStatus() { return invoke('git_status'); },
    async tasks(prefix = '') {
      if (indexState === 'indexing') {
        await Promise.race([
          new Promise<void>(resolve => indexWaiters.add(() => resolve())),
          new Promise(resolve => setTimeout(resolve, 10000)),
        ]);
      }
      return invoke('task_files', { prefix });
    },
    fileHandle(path, metadata = {}) { return new NativeFileHandle(path, metadata as NativeMetadata) as unknown as FileSystemFileHandle; },
    directoryHandle(path) { return new NativeDirectoryHandle(path) as unknown as FileSystemDirectoryHandle; },
    listFilesRecursive(path) { return invoke('fs_list_recursive', { path }); },
    externalFileHandle(path, metadata = {}) { return new NativeExternalFileHandle(path, metadata as NativeMetadata) as unknown as FileSystemFileHandle; },
    externalDirectoryHandle(path) { return new NativeExternalDirectoryHandle(path) as unknown as FileSystemDirectoryHandle; },
    listExternalFilesRecursive(path) { return invoke('external_fs_list_recursive', { path }); },
    referencedAssets(path) { return invoke('fs_referenced_assets', { path }); },
    renamePath(from, to) { return invoke('fs_rename', { from, to }); },
    assetUrl(path) {
      const encoded = path.split('/').map(part => encodeURIComponent(part)).join('/');
      return navigator.userAgent.includes('Windows')
        ? `http://recallstack-asset.localhost/${encoded}`
        : `recallstack-asset://localhost/${encoded}`;
    },
    performanceSnapshot() {
      return {
        elapsedMs: performance.now() - metrics.startedAt,
        transferredBytes: metrics.transferredBytes,
        calls: structuredClone(metrics.calls),
        measures: performance.getEntriesByType('measure').map(entry => ({ name: entry.name, durationMs: entry.duration })),
      };
    },
    close() { return invoke('close_app'); },
    closeApp() { return invoke('close_app'); },
  };

  if (typeof window.__TAURI__?.event?.listen === 'function') {
    window.__TAURI__.event.listen('workspace://changed', (event: { payload: unknown }) => {
      window.dispatchEvent(new CustomEvent('recallstack-native-changed', { detail: event.payload }));
    });
    window.__TAURI__.event.listen('index://status', (event: { payload?: { state?: string } }) => {
      indexState = event.payload?.state || 'unknown';
      if (indexState !== 'indexing') {
        for (const resolve of indexWaiters) resolve();
        indexWaiters.clear();
      }
      window.dispatchEvent(new CustomEvent('recallstack-index-status', { detail: event.payload }));
    });
    window.__TAURI__.event.listen('backup://progress', (event: { payload: unknown }) => {
      window.dispatchEvent(new CustomEvent('recallstack-backup-progress', { detail: event.payload }));
    });
    window.__TAURI__.event.listen('index://progress', (event: { payload: unknown }) => {
      window.dispatchEvent(new CustomEvent('recallstack-index-progress', { detail: event.payload }));
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    const host = document.querySelector('.search-wrap');
    if (host && !document.querySelector('#btn-close-desktop')) {
      const button = document.createElement('button');
      button.id = 'btn-close-desktop';
      button.className = 'btn-icon danger';
      button.title = 'Close RecallStack';
      button.setAttribute('aria-label', 'Close RecallStack');
      button.textContent = '×';
      button.addEventListener('click', () => window.__recallstackNative?.close());
      host.appendChild(button);
    }
    const welcome = document.querySelector('#welcome .welcome-card');
    if (welcome && !document.querySelector('#btn-close-welcome')) {
      const closeWelcome = document.createElement('button');
      closeWelcome.id = 'btn-close-welcome';
      closeWelcome.className = 'btn btn-ghost';
      closeWelcome.textContent = 'Close RecallStack';
      closeWelcome.addEventListener('click', () => window.__recallstackNative?.close());
      welcome.appendChild(closeWelcome);
    }
  });
})();

export {};

// @ts-nocheck
(() => {
  'use strict';

  if (!window.__TAURI_INTERNALS__ || !window.__TAURI__?.core?.invoke) return;

  const rawInvoke = window.__TAURI__.core.invoke;
  const metrics = { startedAt: performance.now(), calls: {}, transferredBytes: 0 };
  let indexState = 'unknown';
  const indexWaiters = new Set();
  async function invoke(command, args = {}) {
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
  const join = (...parts) => parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');
  const baseName = path => path.split(/[\\/]/).filter(Boolean).at(-1) || 'Workspace';

  class NativeFileHandle {
    constructor(path, metadata = {}) {
      this.kind = 'file';
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

    async isSameEntry(other) {
      return other?.kind === 'file' && other.path === this.path;
    }

    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
  }

  class NativeTextFile {
    constructor(path, name, metadata = {}) {
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
    constructor(path) {
      this.path = path;
      this.parts = [];
      this.textOnly = true;
      this.closed = false;
    }

    async write(value) {
      if (this.closed) throw new DOMException('Writable is closed', 'InvalidStateError');
      if (typeof value === 'string') this.parts.push(value);
      else if (value instanceof Blob) { this.textOnly = false; this.parts.push(new Uint8Array(await value.arrayBuffer())); }
      else if (value instanceof ArrayBuffer) { this.textOnly = false; this.parts.push(new Uint8Array(value)); }
      else if (ArrayBuffer.isView(value)) { this.textOnly = false; this.parts.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)); }
      else if (value && value.type === 'write') return this.write(value.data);
      else throw new TypeError('Unsupported file write value');
    }

    async close() {
      if (this.closed) return;
      if (this.textOnly) {
        await invoke('fs_write_text', { path: this.path, text: this.parts.join('') });
        this.closed = true;
        return;
      }
      this.parts = this.parts.map(part => typeof part === 'string' ? new TextEncoder().encode(part) : part);
      const size = this.parts.reduce((total, part) => total + part.byteLength, 0);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of this.parts) { bytes.set(part, offset); offset += part.byteLength; }
      await invoke('fs_write', { path: this.path, bytes: Array.from(bytes) });
      this.closed = true;
    }
  }

  class NativeDirectoryHandle {
    constructor(path = '', name = null) {
      this.kind = 'directory';
      this.path = path;
      this.name = name || baseName(path);
    }

    async *values() {
      const entries = await invoke('fs_list', { path: this.path });
      for (const entry of entries) {
        yield entry.isDir
          ? new NativeDirectoryHandle(entry.path, entry.name)
          : new NativeFileHandle(entry.path, entry);
      }
    }

    async *entries() {
      for await (const entry of this.values()) yield [entry.name, entry];
    }

    async getDirectoryHandle(name, options = {}) {
      validateName(name);
      const path = join(this.path, name);
      const metadata = await invoke('fs_stat', { path });
      if (!metadata && options.create) await invoke('fs_create_dir', { path });
      else if (!metadata) throw new DOMException(`Directory not found: ${name}`, 'NotFoundError');
      else if (!metadata.isDir) throw new DOMException(`Not a directory: ${name}`, 'TypeMismatchError');
      return new NativeDirectoryHandle(path, name);
    }

    async getFileHandle(name, options = {}) {
      validateName(name);
      const path = join(this.path, name);
      let metadata = await invoke('fs_stat', { path });
      if (!metadata && options.create) {
        await invoke('fs_write', { path, bytes: [] });
        metadata = await invoke('fs_stat', { path });
      } else if (!metadata) throw new DOMException(`File not found: ${name}`, 'NotFoundError');
      if (metadata.isDir) throw new DOMException(`Not a file: ${name}`, 'TypeMismatchError');
      return new NativeFileHandle(path, metadata);
    }

    async removeEntry(name, options = {}) {
      validateName(name);
      return invoke('fs_remove', { path: join(this.path, name), recursive: !!options.recursive });
    }

    async isSameEntry(other) {
      return other?.kind === 'directory' && other.path === this.path;
    }

    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
  }

  function validateName(name) {
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
      throw new TypeError('Invalid file or directory name');
    }
  }

  function mimeType(name) {
    const extension = name.split('.').pop()?.toLowerCase();
    return ({ md: 'text/markdown', txt: 'text/plain', html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', mp3: 'audio/mpeg', mp4: 'video/mp4' })[extension] || 'application/octet-stream';
  }

  function isTextFile(name) {
    // Markdown is consumed as text throughout RecallStack. Other text-like files
    // may be passed to URL.createObjectURL(), which requires a real File/Blob.
    return /\.md$/i.test(name);
  }

  async function activateWorkspace(path) {
    performance.mark('recallstack:workspace-open-start');
    indexState = 'indexing';
    const summary = await invoke('set_workspace', { path });
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
    return activateWorkspace(path);
  };

  window.__recallstackNative = {
    active: true,
    async saveWorkspaceHandle() {},
    async loadWorkspaceHandle() {
      const path = localStorage.getItem(savedPathKey);
      if (!path) return null;
      try { return await activateWorkspace(path); }
      catch (error) { console.warn('Could not reopen RecallStack workspace', error); return null; }
    },
    search(query, prefix = '') { return invoke('search_notes', { query, prefix }); },
    recentWorkspaces() { return invoke('recent_workspaces'); },
    openWorkspacePath(path) { return activateWorkspace(path); },
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
    rebuildIndex() { return invoke('rebuild_index'); },
    cancelIndex() { return invoke('cancel_index'); },
    indexHealth() { return invoke('index_health'); },
    gitStatus() { return invoke('git_status'); },
    async tasks(prefix = '') {
      if (indexState === 'indexing') {
        await Promise.race([
          new Promise(resolve => indexWaiters.add(resolve)),
          new Promise(resolve => setTimeout(resolve, 10000)),
        ]);
      }
      return invoke('task_files', { prefix });
    },
    fileHandle(path, metadata = {}) { return new NativeFileHandle(path, metadata); },
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

  // The desktop build is always offline and ships its rendering dependencies.
  localStorage.setItem('pkm-sql-source', 'local');

  if (typeof window.__TAURI__?.event?.listen === 'function') {
    window.__TAURI__.event.listen('workspace://changed', event => {
      window.dispatchEvent(new CustomEvent('recallstack-native-changed', { detail: event.payload }));
    });
    window.__TAURI__.event.listen('index://status', event => {
      indexState = event.payload?.state || 'unknown';
      if (indexState !== 'indexing') {
        for (const resolve of indexWaiters) resolve();
        indexWaiters.clear();
      }
      window.dispatchEvent(new CustomEvent('recallstack-index-status', { detail: event.payload }));
    });
    window.__TAURI__.event.listen('backup://progress', event => {
      window.dispatchEvent(new CustomEvent('recallstack-backup-progress', { detail: event.payload }));
    });
    window.__TAURI__.event.listen('index://progress', event => {
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
      button.addEventListener('click', () => window.__recallstackNative.close());
      host.appendChild(button);
    }
    const welcome = document.querySelector('#welcome .welcome-card');
    if (welcome && !document.querySelector('#btn-close-welcome')) {
      const closeWelcome = document.createElement('button');
      closeWelcome.id = 'btn-close-welcome';
      closeWelcome.className = 'btn btn-ghost';
      closeWelcome.textContent = 'Close RecallStack';
      closeWelcome.addEventListener('click', () => window.__recallstackNative.close());
      welcome.appendChild(closeWelcome);
    }
  });
})();

export {};

(() => {
  'use strict';

  if (!window.__TAURI_INTERNALS__ || !window.__TAURI__?.core?.invoke) return;

  const invoke = window.__TAURI__.core.invoke;
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

  class NativeWritable {
    constructor(path) {
      this.path = path;
      this.parts = [];
      this.closed = false;
    }

    async write(value) {
      if (this.closed) throw new DOMException('Writable is closed', 'InvalidStateError');
      if (typeof value === 'string') this.parts.push(new TextEncoder().encode(value));
      else if (value instanceof Blob) this.parts.push(new Uint8Array(await value.arrayBuffer()));
      else if (value instanceof ArrayBuffer) this.parts.push(new Uint8Array(value));
      else if (ArrayBuffer.isView(value)) this.parts.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      else if (value && value.type === 'write') return this.write(value.data);
      else throw new TypeError('Unsupported file write value');
    }

    async close() {
      if (this.closed) return;
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
      const exists = await invoke('fs_exists', { path });
      if (!exists && options.create) await invoke('fs_create_dir', { path });
      else if (!exists) throw new DOMException(`Directory not found: ${name}`, 'NotFoundError');
      return new NativeDirectoryHandle(path, name);
    }

    async getFileHandle(name, options = {}) {
      validateName(name);
      const path = join(this.path, name);
      const exists = await invoke('fs_exists', { path });
      if (!exists && options.create) await invoke('fs_write', { path, bytes: [] });
      else if (!exists) throw new DOMException(`File not found: ${name}`, 'NotFoundError');
      return new NativeFileHandle(path, { name });
    }

    async removeEntry(name, options = {}) {
      validateName(name);
      await invoke('fs_remove', { path: join(this.path, name), recursive: !!options.recursive });
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

  async function activateWorkspace(path) {
    const summary = await invoke('set_workspace', { path });
    localStorage.setItem(savedPathKey, summary.path);
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
    close() { return invoke('close_app'); },
  };

  // The desktop build is always offline and ships its rendering dependencies.
  localStorage.setItem('pkm-sql-source', 'local');

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

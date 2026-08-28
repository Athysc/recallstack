export interface EditorTab {
  id: number;
  path: string | null;
  title: string;
  isNew: boolean;
  dirty: boolean;
  isOutputsFile: boolean;
  outputsFileHandle: FileSystemFileHandle | null;
  outputsDirHandle: FileSystemDirectoryHandle | null;
  returnToOutputs: boolean;
  // True for a file opened "Temporary — view/edit in place" from Open/Import
  // Files: it lives outside the workspace at its original OS location. Save
  // writes back there directly; it can never be archived, and Move behaves
  // like Import instead of the normal in-workspace move (see runtime.ts).
  isExternalFile: boolean;
  // Absolute OS path used by the Tauri desktop bridge (external_fs_* commands).
  // Null in browser mode, where externalFileHandle is used instead.
  externalPath: string | null;
  // Real FileSystemFileHandle used in browser (non-Tauri) mode, obtained from
  // window.showOpenFilePicker() or a drag-and-drop DataTransferItem.
  externalFileHandle: FileSystemFileHandle | null;
  // Pinned tabs are opened explicitly (Ctrl+click) and persist until closed.
  // At most one unpinned "dynamic" tab exists at a time — opening another
  // document without Ctrl retargets that same tab instead of adding a new
  // one, matching a preview-tab UX rather than accumulating tabs per click.
  pinned: boolean;
}

export interface EditorDocumentSnapshot {
  path: string | null;
  content: string;
  savedContent: string | null;
  isNew: boolean;
  isOutputsFile: boolean;
  outputsFileHandle: FileSystemFileHandle | null;
  outputsDirHandle: FileSystemDirectoryHandle | null;
  returnToOutputs: boolean;
  isExternalFile: boolean;
  externalPath: string | null;
  externalFileHandle: FileSystemFileHandle | null;
}

export const findTabByPath = (tabs: EditorTab[], path: string | null): EditorTab | null =>
  path == null ? null : tabs.find(tab => tab.path === path) || null;

export const activeTab = (tabs: EditorTab[], activeId: number | null): EditorTab | null =>
  tabs.find(tab => tab.id === activeId) || null;

export function remapTabPaths(
  tabs: EditorTab[],
  oldPrefix: string,
  newPrefix: string,
  titleForPath: (path: string, outputs?: boolean) => string,
): void {
  tabs.forEach(tab => {
    // External-file tabs are keyed by an absolute OS path (or a handle), never
    // by a workspace-relative path, so a workspace folder rename can't apply here.
    if (!tab.isOutputsFile && !tab.isExternalFile && tab.path?.startsWith(oldPrefix)) {
      tab.path = newPrefix + tab.path.slice(oldPrefix.length);
      tab.title = titleForPath(tab.path, false);
    }
  });
}

export function reorderTabs(tabs: EditorTab[], draggedId: number, targetId: number, placeAfter: boolean): boolean {
  if (draggedId === targetId) return false;
  const from = tabs.findIndex(tab => tab.id === draggedId);
  if (from < 0) return false;
  const [moved] = tabs.splice(from, 1);
  const target = tabs.findIndex(tab => tab.id === targetId);
  if (target < 0) {
    tabs.splice(from, 0, moved);
    return false;
  }
  tabs.splice(placeAfter ? target + 1 : target, 0, moved);
  return true;
}

export function relativeTab(tabs: EditorTab[], activeId: number | null, delta: number): EditorTab | null {
  if (tabs.length < 2) return null;
  const index = tabs.findIndex(tab => tab.id === activeId);
  return index < 0 ? null : tabs[(index + delta + tabs.length) % tabs.length];
}

export function syncTabFromDocument(
  tab: EditorTab | null,
  snapshot: EditorDocumentSnapshot,
  titleForPath: (path: string | null, outputs?: boolean) => string,
): boolean {
  if (!tab) return false;
  const previousDirty = tab.dirty;
  Object.assign(tab, {
    path: snapshot.path,
    isNew: snapshot.isNew,
    isOutputsFile: snapshot.isOutputsFile,
    outputsFileHandle: snapshot.outputsFileHandle,
    outputsDirHandle: snapshot.outputsDirHandle,
    returnToOutputs: snapshot.returnToOutputs,
    isExternalFile: snapshot.isExternalFile,
    externalPath: snapshot.externalPath,
    externalFileHandle: snapshot.externalFileHandle,
    title: titleForPath(snapshot.path, snapshot.isOutputsFile || snapshot.isExternalFile),
    dirty: snapshot.isNew
      ? snapshot.content.trim() !== "" && snapshot.content !== (snapshot.savedContent ?? "")
      : Boolean(snapshot.path) && snapshot.content !== snapshot.savedContent,
  });
  return tab.dirty !== previousDirty;
}

export function rememberClosedTab(
  history: Array<{ path: string; title: string }>,
  tab: EditorTab,
  limit = 20,
): void {
  // External-file tabs aren't reopenable via the normal workspace-relative
  // path lookup that "reopen closed tab" uses, so they're excluded here too.
  if (!tab.path || tab.isOutputsFile || tab.isExternalFile) return;
  history.push({ path: tab.path, title: tab.title });
  while (history.length > limit) history.shift();
}

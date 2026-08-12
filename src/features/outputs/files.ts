import { FILE_TYPE_GROUPS, fileExt, formatMtime, inboxFileGroup, sortFiles, type FileSortMode } from "../notes/file-list.ts";

type IterableDirectory = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

export interface OutputFile {
  name: string;
  handle: FileSystemFileHandle;
  dirHandle: FileSystemDirectoryHandle;
  mtime: number;
  subPath: string;
}

function isNotFound(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && error.name === "NotFoundError";
}

export async function listOutputFiles(directory: FileSystemDirectoryHandle, prefix = "", nativeActive = false): Promise<OutputFile[]> {
  const files: OutputFile[] = [];
  for await (const entry of (directory as IterableDirectory).values()) {
    if (entry.name.startsWith(".")) continue;
    if (entry.kind === "directory") {
      files.push(...await listOutputFiles(entry, prefix ? `${prefix}/${entry.name}` : entry.name, nativeActive));
      continue;
    }
    let mtime: number;
    try {
      const metadata = (entry as FileSystemFileHandle & { metadata?: { modifiedAt?: number } }).metadata;
      mtime = nativeActive && metadata?.modifiedAt != null ? metadata.modifiedAt : (await entry.getFile()).lastModified;
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    files.push({ name: entry.name, handle: entry, dirHandle: directory, mtime, subPath: prefix ? `${prefix}/${entry.name}` : entry.name });
  }
  return files;
}

export function groupOutputFiles(files: OutputFile[], mode: FileSortMode): Map<string, OutputFile[]> {
  const grouped = new Map(FILE_TYPE_GROUPS.map(group => [group.key, [] as OutputFile[]]));
  files.forEach(file => grouped.get(inboxFileGroup(file.name).key)!.push(file));
  grouped.forEach((entries, key) => grouped.set(key, sortFiles(entries, mode)));
  return grouped;
}

export function outputDocumentPath(root: string, folder: string, subPath: string): string {
  return `${root}/outputs/${folder}/${subPath}`;
}

export interface OutputRenderActions {
  openMarkdown(file: OutputFile, event: MouseEvent): void;
  openOther(file: OutputFile): void;
}

export function renderOutputFiles(
  container: HTMLElement,
  files: OutputFile[],
  mode: FileSortMode,
  escape: (value: string) => string,
  actions: OutputRenderActions,
): void {
  container.replaceChildren();
  const grouped = groupOutputFiles(files, mode);
  FILE_TYPE_GROUPS.forEach(group => {
    const entries = grouped.get(group.key)!;
    if (!entries.length) return;
    const section = document.createElement("div");
    section.className = "inbox-section";
    const header = document.createElement("div");
    header.className = "inbox-section-header";
    header.innerHTML = `<span class="inbox-section-title">${group.icon} ${escape(group.label)}</span><span class="inbox-section-count">${entries.length} file${entries.length !== 1 ? "s" : ""}</span>`;
    section.appendChild(header);
    entries.forEach(file => {
      const markdown = group.key === "markdown";
      const extension = `.${fileExt(file.name)}`;
      const displayName = markdown ? file.name.replace(/\.md$/i, "") : file.name.slice(0, -extension.length) || file.name;
      const folder = file.subPath.split("/").slice(0, -1).join("/");
      const card = document.createElement("div");
      card.className = "file-card";
      if (!markdown) {
        card.classList.add("file-card-inbox-nonmd");
        card.tabIndex = 0;
        card.title = "Double-click or press Enter to open";
      }
      const icon = document.createElement("span");
      icon.className = "file-icon";
      icon.textContent = group.icon;
      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = displayName;
      card.append(icon, name);
      if (folder) {
        const subpath = document.createElement("span");
        subpath.className = "outputs-subpath";
        subpath.title = folder;
        subpath.textContent = folder;
        card.appendChild(subpath);
      }
      const metadata = document.createElement("span");
      metadata.className = "file-meta";
      metadata.textContent = formatMtime(file.mtime);
      const extensionLabel = document.createElement("span");
      extensionLabel.className = "file-ext";
      extensionLabel.textContent = markdown ? ".md" : extension;
      card.append(metadata, extensionLabel);
      if (markdown) card.addEventListener("click", event => actions.openMarkdown(file, event));
      else {
        card.addEventListener("dblclick", () => actions.openOther(file));
        card.addEventListener("keydown", event => {
          if (event.key === "Enter") { event.preventDefault(); actions.openOther(file); }
        });
      }
      section.appendChild(card);
    });
    container.appendChild(section);
  });
}

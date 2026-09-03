import { nextDuplicateFilename } from "../features/tasks/filenames.ts";

export interface NamedDirectory {
  name: string;
  handle: FileSystemDirectoryHandle;
}

export interface ListedFile {
  name: string;
  handle: FileSystemFileHandle;
  mtime: number;
}

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

export async function getDirHandle(
  base: FileSystemDirectoryHandle,
  parts: readonly string[],
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let current = base;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create });
  return current;
}

export async function ensureWorkspaceStructure(root: FileSystemDirectoryHandle): Promise<void> {
  let dataDir: FileSystemDirectoryHandle;
  let createStarterTree = false;
  try {
    dataDir = await root.getDirectoryHandle("Data");
  } catch (error) {
    if (!error || typeof error !== "object" || !("name" in error) || error.name !== "NotFoundError") throw error;
    dataDir = await root.getDirectoryHandle("Data", { create: true });
    createStarterTree = true;
  }
  if (createStarterTree) {
    const notesWorkspace = await dataDir.getDirectoryHandle("notes", { create: true });
    const mynotes = await notesWorkspace.getDirectoryHandle("mynotes", { create: true });
    await mynotes.getDirectoryHandle("notes", { create: true });
    // tasks/ and dailylogs/ are global roots, siblings of the workspace folders.
    await dataDir.getDirectoryHandle("tasks", { create: true });
    await dataDir.getDirectoryHandle("dailylogs", { create: true });
  }
  const dbDir = await root.getDirectoryHandle("DB", { create: true });
  await dbDir.getFileHandle("index.db", { create: true });
}

export async function listDirs(dirHandle: FileSystemDirectoryHandle): Promise<NamedDirectory[]> {
  const result: NamedDirectory[] = [];
  for await (const entry of (dirHandle as IterableDirectoryHandle).values()) {
    if (entry.kind === "directory" && !entry.name.startsWith(".")) {
      result.push({ name: entry.name, handle: entry });
    }
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

export async function dirExists(dirHandle: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  const expected = name.toLowerCase();
  for await (const entry of (dirHandle as IterableDirectoryHandle).values()) {
    if (entry.kind === "directory" && entry.name.toLowerCase() === expected) return true;
  }
  return false;
}

async function entryMtime(entry: FileSystemFileHandle): Promise<number> {
  const metadata = (entry as FileSystemFileHandle & { metadata?: { modifiedAt?: number } }).metadata;
  if (window.__recallstackNative?.active && metadata?.modifiedAt != null) return metadata.modifiedAt;
  return (await entry.getFile()).lastModified;
}

export async function listFiles(
  dirHandle: FileSystemDirectoryHandle,
  markdownOnly = false,
): Promise<ListedFile[]> {
  const result: ListedFile[] = [];
  for await (const entry of (dirHandle as IterableDirectoryHandle).values()) {
    if (entry.kind !== "file" || entry.name.startsWith(".")) continue;
    if (markdownOnly && !entry.name.toLowerCase().endsWith(".md")) continue;
    result.push({ name: entry.name, handle: entry, mtime: await entryMtime(entry) });
  }
  return result;
}

export const listMdFiles = (dirHandle: FileSystemDirectoryHandle): Promise<ListedFile[]> =>
  listFiles(dirHandle, true);

export const listAllFiles = (dirHandle: FileSystemDirectoryHandle): Promise<ListedFile[]> =>
  listFiles(dirHandle, false);

export async function fileExistsInDir(dirHandle: FileSystemDirectoryHandle, filename: string): Promise<boolean> {
  const expected = filename.toLowerCase();
  for await (const entry of (dirHandle as IterableDirectoryHandle).values()) {
    if (entry.kind === "file" && entry.name.toLowerCase() === expected) return true;
  }
  return false;
}

export async function uniqueFilenameInDir(
  dirHandle: FileSystemDirectoryHandle,
  filename: string,
): Promise<string> {
  const filenames = new Set<string>();
  for await (const entry of (dirHandle as IterableDirectoryHandle).values()) {
    if (entry.kind === "file") filenames.add(entry.name.toLowerCase());
  }
  if (!filenames.has(filename.toLowerCase())) return filename;
  return nextDuplicateFilename(filename, candidate => filenames.has(candidate.toLowerCase()));
}

export interface MarkdownFilesystemOptions {
  notesHandle: () => FileSystemDirectoryHandle;
  // Native path prefix for a workspace-relative path. Path-aware because the
  // global tasks/dailylogs roots live at `Data/` while normal notes live at
  // `Data/<workspace>/`.
  dbPrefix: (path: string) => string;
  nativeVersions: Map<string, string>;
  // True when a workspace-relative path lives outside the workspace Data/ tree
  // (the Extra Data Folder). Such paths skip the native readText/writeText
  // shortcut and go handle-based through resolveDir().
  isExternalPath?: (path: string) => boolean;
  // Resolves a folder path (already split into parts) to its directory handle,
  // routing Extra Data Folder parts to the external handle.
  resolveDir?: (parts: string[], create?: boolean) => Promise<FileSystemDirectoryHandle>;
}

export function createMarkdownFilesystem(options: MarkdownFilesystemOptions) {
  const resolveDir = (parts: string[], create = false) =>
    options.resolveDir
      ? options.resolveDir(parts, create)
      : getDirHandle(options.notesHandle(), parts, create);

  async function read(path: string): Promise<string> {
    if (window.__recallstackNative?.active && !options.isExternalPath?.(path)) {
      const nativePath = options.dbPrefix(path) + path;
      const result = await window.__recallstackNative.readText(nativePath);
      options.nativeVersions.set(nativePath, result.version);
      return result.text;
    }
    const parts = path.split("/");
    const dir = await resolveDir(parts.slice(0, -1));
    return (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).text();
  }

  async function write(path: string, content: string): Promise<void> {
    if (window.__recallstackNative?.active && !options.isExternalPath?.(path)) {
      const nativePath = options.dbPrefix(path) + path;
      const version = await window.__recallstackNative.writeText(
        nativePath,
        content,
        options.nativeVersions.get(nativePath) || null,
      );
      options.nativeVersions.set(nativePath, version);
      return;
    }
    const parts = path.split("/");
    const dir = await resolveDir(parts.slice(0, -1), true);
    const writable = await (await dir.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
    try {
      await writable.write(content);
    } finally {
      await writable.close();
    }
  }

  async function remove(path: string): Promise<void> {
    const parts = path.split("/");
    const dir = await resolveDir(parts.slice(0, -1));
    await dir.removeEntry(parts.at(-1)!);
    options.nativeVersions.delete(options.dbPrefix(path) + path);
  }

  async function uniquePath(folderParts: string[], filename: string): Promise<string> {
    const dir = await resolveDir(folderParts, true);
    return [...folderParts, await uniqueFilenameInDir(dir, filename)].join("/");
  }

  return { read, write, remove, uniquePath };
}

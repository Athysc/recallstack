type IterableDirectory = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "tiff", "tif", "ico"]);

export interface AssetLocation {
  parentParts: string[];
  prefix: "assets/" | "../assets/";
}

export function assetLocation(currentPath: string | null, activeFolderPath: string): AssetLocation {
  const folderParts = currentPath ? currentPath.split("/").slice(0, -1) : activeFolderPath.split("/").filter(Boolean);
  if (!folderParts.length) throw new Error("No active folder");
  const archived = folderParts.at(-1) === "archived";
  return { parentParts: archived ? folderParts.slice(0, -1) : folderParts, prefix: archived ? "../assets/" : "assets/" };
}

export function clipFilename(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `clip-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.png`;
}

export function isImageFilename(name: string): boolean {
  return IMAGE_EXTENSIONS.has(name.split(".").at(-1)?.toLowerCase() ?? "");
}

export function referencedAssets(markdown: string): Set<string> {
  const references = new Set<string>();
  for (const match of markdown.matchAll(/\]\((?:\.\.\/)?assets\/([^)]+)\)/g)) {
    try { references.add(decodeURIComponent(match[1])); } catch { references.add(match[1]); }
  }
  return references;
}

export async function collectReferencedAssets(directory: FileSystemDirectoryHandle, references = new Set<string>()): Promise<Set<string>> {
  for await (const entry of (directory as IterableDirectory).values()) {
    if (entry.name.startsWith(".")) continue;
    if (entry.kind === "file" && entry.name.endsWith(".md")) {
      try {
        const text = await (await entry.getFile()).text();
        referencedAssets(text).forEach(reference => references.add(reference));
      } catch { /* unreadable notes do not prevent the audit */ }
    } else if (entry.kind === "directory" && entry.name !== "assets") {
      await collectReferencedAssets(entry, references);
    }
  }
  return references;
}

export function orphanAssetNames(assetNames: readonly string[], references: ReadonlySet<string>): string[] {
  return assetNames.filter(name => !references.has(name)).sort((left, right) => left.localeCompare(right));
}

export function formatAssetSize(size: number): string {
  return size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;
}

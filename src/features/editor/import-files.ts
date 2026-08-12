// Pure logic backing the "Open / Import Files" modal (see recallstack-runtime.ts).
// Kept DOM- and Tauri-free so it can be unit tested without a real workspace or
// native runtime, matching the style of tabs.ts and filesystem.ts.

const MARKDOWN_EXTENSION_RE = /\.md$/i;

export function isMarkdownFilename(name: string): boolean {
  return MARKDOWN_EXTENSION_RE.test(name);
}

export interface PartitionedFilenames {
  accepted: string[];
  rejected: string[];
}

// Splits a batch of picked/dropped filenames into ones the modal will accept
// (.md) and ones it must reject with a toast — only Markdown is in scope.
export function partitionMarkdownFilenames(names: readonly string[]): PartitionedFilenames {
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const name of names) {
    (isMarkdownFilename(name) ? accepted : rejected).push(name);
  }
  return { accepted, rejected };
}

export interface SelectableFile {
  // Unique identity for de-duplication: the absolute OS path in Tauri desktop
  // mode, or a handle-derived key (e.g. name) in browser mode.
  key: string;
  name: string;
}

// Browse and drag-and-drop feed the same in-modal list; picking (or dropping)
// a file already on the list must not add a second row for it.
export function mergeSelectedFiles<T extends SelectableFile>(existing: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(existing.map(file => file.key));
  const merged = existing.slice();
  for (const file of incoming) {
    if (seen.has(file.key)) continue;
    seen.add(file.key);
    merged.push(file);
  }
  return merged;
}

export function removeSelectedFile<T extends SelectableFile>(files: readonly T[], key: string): T[] {
  return files.filter(file => file.key !== key);
}

// Mirrors selectedMoveDestination()'s rule for the existing Move File modal:
// a destination is a top-level folder plus a chosen subfolder — the
// workspace root itself is never a valid destination.
export function resolveImportDestination(
  topName: string | null | undefined,
  subName: string | null | undefined,
): [string, string] | null {
  if (!topName) return null;
  if (!subName || subName === '__root__') return null;
  return [topName, subName];
}

export function buildImportedFilePath(destinationParts: readonly string[], filename: string): string {
  return [...destinationParts, filename].join('/');
}

export type OpenImportMode = 'temporary' | 'import';

// The primary action button's label/enablement depends on how many files are
// selected and (only when importing) whether a destination has been chosen.
export function openImportActionEnabled(
  fileCount: number,
  mode: OpenImportMode,
  destination: readonly string[] | null,
): boolean {
  if (fileCount < 1) return false;
  if (mode === 'import') return destination != null;
  return true;
}

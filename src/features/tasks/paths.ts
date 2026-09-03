export const TASKS_ROOT = "tasks";
export const DAILYLOGS_ROOT = "dailylogs";

// True when a workspace-relative path belongs to the global tasks / dailylogs
// roots (`Data/tasks/**`, `Data/dailylogs/**`) rather than a normal workspace
// folder. Those roots are shared across every workspace, so file IO, the native
// DB prefix, and tab ownership all key off this instead of the active workspace.
export function isGlobalTasksPath(path: string | null | undefined): boolean {
  const first = (path ?? "").split("/")[0];
  return first === TASKS_ROOT || first === DAILYLOGS_ROOT;
}

export function isWorkspaceTaskPath(path: string | null | undefined): boolean {
  const parts = path?.split("/") ?? [];
  return parts[0] === TASKS_ROOT && parts[1] !== "archived" && parts[1] !== undefined && !isJournalPath(path);
}

export function isWorkspaceWorkingTaskPath(path: string | null | undefined): boolean {
  const parts = path?.split("/") ?? [];
  return parts[0] === TASKS_ROOT && parts[1] === "working";
}

export function isJournalPath(path: string | null | undefined): boolean {
  const parts = path?.split("/") ?? [];
  return parts[0] === DAILYLOGS_ROOT && /^journal-\d{8}\.md$/i.test(parts.at(-1) || "");
}

export function journalTitleFromPath(path: string | null | undefined): string | null {
  if (!isJournalPath(path)) return null;
  return path!.split("/").at(-1)?.replace(/\.md$/i, "") || null;
}

export function journalLocationForDate(_rootParts: readonly string[], date: string): {
  filename: string;
  targetParts: string[];
  path: string;
} | null {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const filename = `journal-${year}${month}${day}.md`;
  const targetParts = [DAILYLOGS_ROOT, year, month];
  return { filename, targetParts, path: [...targetParts, filename].join("/") };
}

export function latestJournalPathBefore(
  paths: readonly string[],
  _rootParts: readonly string[],
  date: string,
): string | null {
  const target = date.replaceAll("-", "");
  if (!/^\d{8}$/.test(target)) return null;
  return paths
    .filter(path => path.startsWith(`${DAILYLOGS_ROOT}/`))
    .map(path => ({ path, key: path.match(/\/journal-(\d{8})\.md$/i)?.[1] || "" }))
    .filter(entry => entry.key && entry.key < target)
    .sort((left, right) => right.key.localeCompare(left.key))[0]?.path || null;
}

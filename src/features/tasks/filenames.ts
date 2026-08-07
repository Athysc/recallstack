export interface TaskFilenameMetadata {
  title: string;
  startDate: string | null;
  completedDate: string | null;
  dueDate: string | null;
  priority: string;
}

export const TASK_FILENAME_RE = /^(.*?)\s*--\s*s(\d{8})_c(\d{8})_due(\d{8})_([a-z0-9]+)$/i;

export function normalizeTaskPriority(priority: unknown): string {
  return String(priority || "normal").toLowerCase().replace(/[-_\s]+/g, "");
}

export function taskDateFromFilenameValue(value: string): string | null {
  return value && value !== "00000000" && /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : null;
}

export function taskDateToFilenameValue(value: string | null | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replaceAll("-", "") : "00000000";
}

export function parseTaskFilename(name: unknown): TaskFilenameMetadata | null {
  const stem = String(name || "").replace(/\.md$/i, "");
  const match = stem.match(TASK_FILENAME_RE);
  if (!match) return null;
  return {
    title: match[1].trim(),
    startDate: taskDateFromFilenameValue(match[2]),
    completedDate: taskDateFromFilenameValue(match[3]),
    dueDate: taskDateFromFilenameValue(match[4]),
    priority: match[5].toLowerCase(),
  };
}

export function taskDisplayTitle(name: unknown): string {
  return parseTaskFilename(name)?.title || String(name).replace(/\.md$/i, "");
}

export function buildTaskFilename(title: unknown, metadata: Partial<TaskFilenameMetadata>): string {
  const cleanTitle = String(title || "").replace(/\.md$/i, "").replace(TASK_FILENAME_RE, "$1").trim() || "Untitled";
  return `${cleanTitle} -- s${taskDateToFilenameValue(metadata.startDate)}_c${taskDateToFilenameValue(metadata.completedDate)}_due${taskDateToFilenameValue(metadata.dueDate)}_${normalizeTaskPriority(metadata.priority)}.md`;
}

type FilenameExists = (filename: string) => boolean | Promise<boolean>;

function splitFilename(filename: string): { stem: string; extension: string } {
  const dot = filename.lastIndexOf(".");
  return dot > 0
    ? { stem: filename.slice(0, dot), extension: filename.slice(dot) }
    : { stem: filename, extension: "" };
}

/** Return Name (2), Name (3), etc., while keeping task metadata parseable and hidden. */
export async function nextDuplicateFilename(filename: string, exists: FilenameExists): Promise<string> {
  const task = parseTaskFilename(filename);
  const { stem, extension } = splitFilename(filename);
  const base = (task?.title || stem).replace(/\s+\(\d+\)$/u, "").trim() || "Untitled";

  for (let number = 2; ; number += 1) {
    const numberedTitle = `${base} (${number})`;
    const candidate = task
      ? buildTaskFilename(numberedTitle, task)
      : `${numberedTitle}${extension}`;
    if (!await exists(candidate)) return candidate;
  }
}

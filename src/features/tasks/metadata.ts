import { parseTaskFilename } from "./filenames.ts";

export interface TaskMetadata {
  title?: string;
  priority: string | null;
  startDate: string | null;
  completedDate: string | null;
  dueDate: string | null;
}

export const TASK_HEADER = `Priority: **Normal**\nStart Date: \nCompleted Date: \nDue Date: \n\n---\n\n`;
const TASK_HEADER_FIELDS = /^(Priority|Start Date|Completed Date|Due Date|Done):\s*/i;

export function taskHeaderEndAt(lines: string[], start: number): number | null {
  let index = start;
  let fields = 0;
  while (index < lines.length) {
    if (TASK_HEADER_FIELDS.test(lines[index])) { fields++; index++; }
    else if (lines[index] === "") index++;
    else break;
  }
  return fields && /^---\s*$/.test(lines[index] ?? "") ? index + 1 : null;
}

export function removeLegacyTaskHeader(content: string): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const end = taskHeaderEndAt(lines, 0);
  return end === null ? content : lines.slice(end).join("\n").replace(/^\n+/, "");
}

export function hasStandardTaskHeader(content: string): boolean {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const fields = ["Priority", "Start Date", "Completed Date", "Due Date"];
  let index = 0;
  for (const field of fields) {
    if (!new RegExp(`^${field}:\\s*`, "i").test(lines[index] ?? "")) return false;
    index++;
  }
  while (lines[index] === "") index++;
  return /^---\s*$/.test(lines[index] ?? "");
}

export function makeTaskContent(content: string): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const headers: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (true) {
    while (lines[start] === "") start++;
    const end = taskHeaderEndAt(lines, start);
    if (end === null) break;
    headers.push({ start, end });
    start = end;
  }
  if (!headers.length) return TASK_HEADER + content;
  if (headers.length === 1) return content;
  return [...lines.slice(0, headers[0].end), ...lines.slice(headers.at(-1)!.end)].join("\n");
}

export function parseTaskDates(content: string): TaskMetadata {
  const result: TaskMetadata = { priority: null, startDate: null, completedDate: null, dueDate: null };
  let inFence = false;
  for (const line of content.split("\n")) {
    if (/^(`{3,}|~{3,})/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const value = (pattern: RegExp) => line.match(pattern)?.[1]?.replace(/^\*\*|\*\*$/g, "") || null;
    result.priority ||= value(/^Priority:\s*(\S+)/i);
    result.startDate ||= value(/^Start Date:\s*(\S+)/i);
    result.completedDate ||= value(/^Completed Date:\s*(\S+)/i);
    result.dueDate ||= value(/^Due Date:\s*(\S+)/i);
  }
  return result;
}

export function taskMetaFor(filename: string | null | undefined, content: string): TaskMetadata {
  const named = parseTaskFilename(filename || "");
  return named || { title: String(filename || "").replace(/\.md$/i, ""), ...parseTaskDates(content || "") };
}

export function parseDateLocal(value: string | null | undefined): Date | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(+match[1], +match[2] - 1, +match[3]) : null;
}

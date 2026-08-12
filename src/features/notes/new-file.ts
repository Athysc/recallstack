import { buildTaskFilename } from "../tasks/filenames.ts";

export type NewMarkdownFileKind = "note" | "task" | "working-task";

export function normalizeMarkdownFilename(value: unknown): string {
  const filename = String(value ?? "").trim();
  if (!filename) return "";
  return filename.toLowerCase().endsWith(".md") ? `${filename.slice(0, -3)}.md` : `${filename}.md`;
}

export function newMarkdownFileTitle(kind: NewMarkdownFileKind): string {
  if (kind === "working-task") return "New Working Task";
  if (kind === "task") return "New Task";
  return "New Note";
}

export function newMarkdownStoredFilename(value: unknown, kind: NewMarkdownFileKind): string {
  const markdownFilename = normalizeMarkdownFilename(value);
  if (!markdownFilename || kind === "note") return markdownFilename;
  return buildTaskFilename(markdownFilename.slice(0, -3), {
    priority: "normal",
    startDate: null,
    completedDate: null,
    dueDate: null,
  });
}

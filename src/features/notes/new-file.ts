import { documentExtension, stripDocumentExtension } from "../editor/document-kind.ts";
import { buildTaskFilename } from "../tasks/filenames.ts";

export type NewMarkdownFileKind = "note" | "task" | "working-task";

export function normalizeMarkdownFilename(value: unknown): string {
  const filename = String(value ?? "").trim();
  if (!filename) return "";
  const extension = documentExtension(filename);
  if (extension) return `${filename.slice(0, -extension.length)}${extension}`;
  return `${filename}.md`;
}

export function newMarkdownFileTitle(kind: NewMarkdownFileKind): string {
  if (kind === "working-task") return "New Working Task";
  if (kind === "task") return "New Task";
  return "New Note";
}

export function newMarkdownStoredFilename(value: unknown, kind: NewMarkdownFileKind): string {
  const markdownFilename = normalizeMarkdownFilename(value);
  if (!markdownFilename || kind === "note") return markdownFilename;
  return buildTaskFilename(stripDocumentExtension(markdownFilename), {
    priority: "normal",
    startDate: null,
    completedDate: null,
    dueDate: null,
  });
}

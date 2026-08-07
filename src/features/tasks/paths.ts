export function isJournalPath(path: string | null | undefined): boolean {
  const parts = path?.split("/") ?? [];
  const taskIndex = parts.indexOf("tasks");
  return taskIndex >= 0 && parts[taskIndex + 1] === "journal";
}

export function journalTitleFromPath(path: string | null | undefined): string | null {
  if (!isJournalPath(path)) return null;
  return path!.split("/").at(-1)?.replace(/\.md$/i, "") || null;
}

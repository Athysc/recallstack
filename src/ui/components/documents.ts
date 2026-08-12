export async function loadDocumentWithFallback(options: {
  portableName: string;
  workspaceName: string;
  readPortable: (name: string) => Promise<string | null>;
  readWorkspace: (name: string) => Promise<string>;
  readBundled: (name: string) => Promise<string>;
  warn?: (message: string, error: unknown) => void;
}): Promise<string> {
  try {
    const portable = await options.readPortable(options.portableName);
    if (portable !== null) return portable;
  } catch (error) {
    options.warn?.(`Could not read ${options.portableName} beside the executable`, error);
  }
  try {
    return await options.readWorkspace(options.workspaceName);
  } catch {
    return options.readBundled(options.portableName);
  }
}

export function healthReportMarkdown(report: {
  notes?: unknown;
  watcher?: unknown;
  findings?: Array<{ severity: string; code: string; path?: string; message: string }>;
}): string {
  const findings = (report.findings ?? [])
    .map(item => `- **${item.severity}** ${item.code}${item.path ? ` — \`${item.path}\`` : ""}: ${item.message}`)
    .join("\n") || "- No findings";
  return `# RecallStack Workspace Health\n\nNotes: ${report.notes}\n\nWatcher: ${report.watcher}\n\n## Findings\n\n${findings}\n`;
}

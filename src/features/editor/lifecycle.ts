export function rewriteAssetLinks(markdown: string, from: string, to: string): string {
  let inFence = false;
  return markdown.split("\n").map(line => {
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      return line;
    }
    return inFence ? line : line.replaceAll(from, to);
  }).join("\n");
}

export function nativeDraftPath(path: string | null, dbPrefix: string): string | null {
  if (!path) return null;
  // Outputs-mode tabs are keyed by a pseudo-path (outputDocumentPath() in
  // features/outputs/files.ts) that isn't workspace-relative — the Outputs
  // folder can live anywhere on disk — so it must not be prefixed with the
  // active workspace's dbPrefix like a normal note path.
  if (/^outputs\//.test(path)) return path;
  return `${dbPrefix || ""}${path}`.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

export function toggleMarkdownCheckbox(markdown: string, targetIndex: number, checked: boolean): string {
  let count = 0;
  let inFence = false;
  return markdown.split("\n").map(line => {
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inFence = !inFence;
      return line;
    }
    if (!inFence && /\[[ xX]\]/.test(line) && count++ === targetIndex) {
      return line.replace(/\[[ xX]\]/, checked ? "[x]" : "[ ]");
    }
    return line;
  }).join("\n");
}

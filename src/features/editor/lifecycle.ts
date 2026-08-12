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
  if (/^(?:openbrain|openbrain-shared)\/outputs\//.test(path)) return path;
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

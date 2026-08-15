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

// Runs a list of "nice to have but not essential" side effects (search-index
// bookkeeping, calendar refresh, etc.), catching each independently so one
// throwing can't stop the others from running or bubble up and be mistaken
// for the essential operation itself having failed.
//
// deleteNote()/archiveNote()/restoreNote() in recallstack-runtime.ts used to
// run this kind of housekeeping *inside* the same try block as the actual
// list-refresh call (cancelEdit()), as the try block's last statement — so a
// housekeeping failure after an already-successful file removal produced a
// "Delete failed" toast and skipped the refresh, even though the file really
// was gone (task_20260815_0001). The fix is to run the essential filesystem
// call in its own try/catch, then run this — housekeeping failures land here
// as a console warning instead of masking the success or blocking whatever
// unconditional finishing steps (toast, cancelEdit()) the caller runs next.
export function runBestEffort(steps: Array<() => void>): void {
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      console.warn("Best-effort step failed after a successful operation", error);
    }
  }
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

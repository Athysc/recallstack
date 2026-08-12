export interface NativeProgress {
  completed?: number;
  total?: number;
  path?: string;
}

export function formatNativeProgress(label: string, progress: NativeProgress): string {
  return `${label} ${progress.completed || 0} of ${progress.total || 0}: ${progress.path || ""}`;
}

export function bindNativeProgressEvents(output: HTMLElement, target: Window = window): () => void {
  const backup = (event: Event) => {
    const label = output.querySelector<HTMLElement>("[data-backup-progress]");
    if (label) label.textContent = formatNativeProgress("Backing up", (event as CustomEvent<NativeProgress>).detail || {});
  };
  const index = (event: Event) => {
    const label = output.querySelector<HTMLElement>("[data-index-progress]");
    if (label) label.textContent = formatNativeProgress("Indexing", (event as CustomEvent<NativeProgress>).detail || {});
  };
  target.addEventListener("recallstack-backup-progress", backup);
  target.addEventListener("recallstack-index-progress", index);
  return () => {
    target.removeEventListener("recallstack-backup-progress", backup);
    target.removeEventListener("recallstack-index-progress", index);
  };
}

import { invoke } from "@tauri-apps/api/core";

export type WorkspaceChangeKind = "create" | "modify" | "remove" | "rename";
export type WorkspaceEntity = "markdown" | "asset" | "directory" | "other";

export interface WorkspaceChange {
  kind: WorkspaceChangeKind;
  path: string;
  previousPath?: string;
  entity: WorkspaceEntity;
  internal: boolean;
}

export interface WorkspaceChangeBatch {
  workspaceId: string;
  sequence: number;
  occurredAt: number;
  overflowed: boolean;
  changes: WorkspaceChange[];
}

export type InvalidationScope = "navigation" | "notes" | "tasks" | "calendar" | "search" | "assets" | "themes";

export class WatcherSequenceGuard {
  private readonly sequences = new Map<string, number>();

  inspect(batch: WorkspaceChangeBatch): { gap: boolean; stale: boolean } {
    const prior = this.sequences.get(batch.workspaceId);
    if (prior !== undefined && batch.sequence <= prior) return { gap: false, stale: true };
    const gap = prior !== undefined && batch.sequence !== prior + 1;
    this.sequences.set(batch.workspaceId, batch.sequence);
    return { gap, stale: false };
  }
}

export function invalidationScopes(batch: WorkspaceChangeBatch): Set<InvalidationScope> {
  const scopes = new Set<InvalidationScope>();
  if (batch.overflowed) {
    return new Set(["navigation", "notes", "tasks", "calendar", "search", "assets", "themes"]);
  }
  for (const change of batch.changes) {
    const path = normalizePath(change.path);
    if (path === "Apps/themes.json") scopes.add("themes");
    if (change.entity === "directory") scopes.add("navigation");
    if (change.entity === "asset") scopes.add("assets");
    if (change.entity === "markdown") {
      scopes.add("notes");
      scopes.add("search");
      if (/\/tasks(?:\/|$)/i.test(path)) {
        scopes.add("tasks");
        scopes.add("calendar");
      }
    }
  }
  return scopes;
}

export function normalizeWorkspaceBatch(value: unknown): WorkspaceChangeBatch | null {
  if (!isRecord(value) || typeof value.workspaceId !== "string" || !Number.isSafeInteger(value.sequence)) return null;
  const rawChanges = Array.isArray(value.changes) ? value.changes : [];
  const changes = rawChanges.flatMap((raw): WorkspaceChange[] => {
    if (!isRecord(raw) || !isKind(raw.kind) || typeof raw.path !== "string" || !isEntity(raw.entity)) return [];
    return [{
      kind: raw.kind,
      path: normalizePath(raw.path),
      previousPath: typeof raw.previousPath === "string" ? normalizePath(raw.previousPath) : undefined,
      entity: raw.entity,
      internal: raw.internal === true,
    }];
  });
  return {
    workspaceId: value.workspaceId,
    sequence: value.sequence as number,
    occurredAt: typeof value.occurredAt === "number" ? value.occurredAt : Date.now(),
    overflowed: value.overflowed === true,
    changes,
  };
}

let installed = false;

export function installWorkspaceWatcher(): void {
  if (installed) return;
  installed = true;
  const guard = new WatcherSequenceGuard();
  let recovery: Promise<unknown> | null = null;
  window.addEventListener("recallstack-native-changed", (event) => {
    const batch = normalizeWorkspaceBatch((event as CustomEvent).detail);
    if (!batch) return;
    const sequence = guard.inspect(batch);
    if (sequence.stale) return;
    if ((sequence.gap || batch.overflowed) && window.__TAURI_INTERNALS__ && !recovery) {
      recovery = invoke("reconcile_workspace")
        .catch((error) => console.error("Workspace watcher reconciliation failed", error))
        .finally(() => { recovery = null; });
    }
    window.dispatchEvent(new CustomEvent("recallstack-workspace-changes", {
      detail: { ...batch, sequenceGap: sequence.gap, scopes: [...invalidationScopes(batch)] },
    }));
  });
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isKind(value: unknown): value is WorkspaceChangeKind {
  return value === "create" || value === "modify" || value === "remove" || value === "rename";
}

function isEntity(value: unknown): value is WorkspaceEntity {
  return value === "markdown" || value === "asset" || value === "directory" || value === "other";
}

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

export interface BufferedWorkspaceChangeBatch extends WorkspaceChangeBatch {
  sequenceGap: boolean;
}

interface PendingWorkspaceBatch {
  workspaceId: string;
  sequence: number;
  occurredAt: number;
  overflowed: boolean;
  sequenceGap: boolean;
  changes: Map<string, WorkspaceChange>;
}

/**
 * Collapses native watcher traffic into one invalidation per workspace.
 * This is especially important when WebView2 resumes a view whose JavaScript
 * tasks were suspended while the window was hidden: the native watcher keeps
 * running, but the frontend should not replay every intermediate refresh.
 */
/**
 * Once a buffered workspace holds this many distinct changed paths (e.g. a sync
 * client or build churning files while the window sat hidden for hours), stop
 * retaining individual entries and collapse to a single "overflowed" batch — the
 * frontend handles that with one full refresh instead of replaying thousands of
 * paths on resume. Keeps memory and resume-time work bounded.
 */
export const MAX_BUFFERED_CHANGES = 2000;

export class WorkspaceBatchAccumulator {
  private readonly pending = new Map<string, PendingWorkspaceBatch>();

  add(batch: WorkspaceChangeBatch, sequenceGap = false): void {
    let pending = this.pending.get(batch.workspaceId);
    if (!pending) {
      pending = {
        workspaceId: batch.workspaceId,
        sequence: batch.sequence,
        occurredAt: batch.occurredAt,
        overflowed: batch.overflowed,
        sequenceGap,
        changes: new Map(),
      };
      this.pending.set(batch.workspaceId, pending);
    } else {
      pending.sequence = Math.max(pending.sequence, batch.sequence);
      pending.occurredAt = Math.max(pending.occurredAt, batch.occurredAt);
      pending.overflowed ||= batch.overflowed;
      pending.sequenceGap ||= sequenceGap;
    }
    if (pending.overflowed && pending.changes.size >= MAX_BUFFERED_CHANGES) {
      // Already collapsed — don't keep growing the map.
      pending.changes.clear();
      return;
    }
    for (const change of batch.changes) mergeChange(pending.changes, change);
    if (pending.changes.size >= MAX_BUFFERED_CHANGES) {
      pending.overflowed = true;
      pending.changes.clear();
    }
  }

  takeAll(): BufferedWorkspaceChangeBatch[] {
    const batches = [...this.pending.values()].map(pending => ({
      workspaceId: pending.workspaceId,
      sequence: pending.sequence,
      occurredAt: pending.occurredAt,
      overflowed: pending.overflowed,
      sequenceGap: pending.sequenceGap,
      changes: [...pending.changes.values()].sort((left, right) => left.path.localeCompare(right.path)),
    }));
    this.pending.clear();
    return batches;
  }

  get size(): number {
    return this.pending.size;
  }
}

export function invalidationScopes(batch: WorkspaceChangeBatch): Set<InvalidationScope> {
  const scopes = new Set<InvalidationScope>();
  if (batch.overflowed) {
    return new Set(["navigation", "notes", "tasks", "calendar", "search", "assets", "themes"]);
  }
  for (const change of batch.changes) {
    const path = normalizePath(change.path);
    if (path === "Apps/theme.json") scopes.add("themes");
    if (change.entity === "directory") scopes.add("navigation");
    if (change.entity === "asset") scopes.add("assets");
    if (change.entity === "markdown") {
      scopes.add("notes");
      scopes.add("search");
      const segments = path.split("/");
      // A per-workspace note path is `Data/<ws>/<folder>/...`; a global
      // tasks/journal path is `Data/tasks/...` or `Data/dailylogs/...` with no
      // workspace segment. Check both shapes.
      const workspaceSegments = segments[0] === "Data" && segments.length >= 3 ? segments.slice(2) : segments;
      const globalSegments = segments[0] === "Data" ? segments.slice(1) : segments;
      const first = (root: string) => workspaceSegments[0]?.toLowerCase() === root || globalSegments[0]?.toLowerCase() === root;
      if (first("tasks")) {
        scopes.add("tasks");
        scopes.add("calendar");
      }
      if (first("dailylogs")) {
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
  const accumulator = new WorkspaceBatchAccumulator();
  let recovery: Promise<unknown> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const diagnostics = {
    receivedBatches: 0,
    deliveredBatches: 0,
    receivedChanges: 0,
    deliveredChanges: 0,
    queuedWhileHidden: 0,
    sequenceGaps: 0,
    overflows: 0,
    reconciliations: 0,
    pendingWorkspaces: 0,
    lastFlushAt: 0,
    backgroundedAt: 0,
    lastBackgroundDurationMs: 0,
    maxEventDeliveryDelayMs: 0,
  };
  window.__recallstackWatcherDiagnostics = diagnostics;

  const dispatch = (batch: BufferedWorkspaceChangeBatch) => {
    diagnostics.deliveredBatches += 1;
    diagnostics.deliveredChanges += batch.changes.length;
    window.dispatchEvent(new CustomEvent("recallstack-workspace-changes", {
      detail: { ...batch, scopes: [...invalidationScopes(batch)] },
    }));
  };

  const flush = () => {
    clearTimeout(flushTimer);
    flushTimer = undefined;
    if (document.visibilityState === "hidden") return;
    const batches = accumulator.takeAll();
    diagnostics.pendingWorkspaces = accumulator.size;
    diagnostics.lastFlushAt = Date.now();
    for (const batch of batches) {
      // An overflow is reconciled immediately by the native watcher worker.
      // A frontend-only sequence gap still needs to request recovery, but the
      // command itself is single-flight and runs its scan off the UI thread.
      if (batch.sequenceGap && !batch.overflowed && window.__TAURI_INTERNALS__) {
        diagnostics.reconciliations += 1;
        if (!recovery) {
          recovery = invoke("reconcile_workspace")
            .catch((error) => console.error("Workspace watcher reconciliation failed", error))
            .finally(() => { recovery = null; });
        }
        void recovery.finally(() => dispatch(batch));
      } else {
        dispatch(batch);
      }
    }
  };

  const scheduleFlush = () => {
    if (document.visibilityState === "hidden") return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 75);
  };

  window.addEventListener("recallstack-native-changed", (event) => {
    const batch = normalizeWorkspaceBatch((event as CustomEvent).detail);
    if (!batch) return;
    const sequence = guard.inspect(batch);
    if (sequence.stale) return;
    diagnostics.receivedBatches += 1;
    diagnostics.receivedChanges += batch.changes.length;
    diagnostics.maxEventDeliveryDelayMs = Math.max(
      diagnostics.maxEventDeliveryDelayMs,
      Math.max(0, Date.now() - batch.occurredAt),
    );
    if (sequence.gap) diagnostics.sequenceGaps += 1;
    if (batch.overflowed) diagnostics.overflows += 1;
    if (document.visibilityState === "hidden") diagnostics.queuedWhileHidden += 1;
    accumulator.add(batch, sequence.gap);
    diagnostics.pendingWorkspaces = accumulator.size;
    scheduleFlush();
  });
  // Tell the native watcher to pause per-file indexing / event emission while
  // the window is hidden, and to run one incremental catch-up when it returns.
  // Nothing "builds up" to replay on resume.
  let lastForegroundSignal: boolean | null = null;
  const signalForeground = (foreground: boolean) => {
    if (foreground === lastForegroundSignal) return;
    lastForegroundSignal = foreground;
    if (window.__TAURI_INTERNALS__) {
      invoke("set_foreground", { foreground }).catch((error) =>
        console.warn("set_foreground failed", error),
      );
    }
  };
  signalForeground(document.visibilityState !== "hidden");

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      diagnostics.backgroundedAt = Date.now();
      signalForeground(false);
    } else {
      if (diagnostics.backgroundedAt) {
        diagnostics.lastBackgroundDurationMs = Date.now() - diagnostics.backgroundedAt;
        diagnostics.backgroundedAt = 0;
      }
      signalForeground(true);
      flush();
    }
  });
  window.addEventListener("pageshow", () => { signalForeground(document.visibilityState !== "hidden"); flush(); });
  window.addEventListener("focus", flush);
}

function mergeChange(changes: Map<string, WorkspaceChange>, incoming: WorkspaceChange): void {
  const key = incoming.path;
  const previous = changes.get(key);
  if (!previous) {
    changes.set(key, incoming);
    return;
  }
  const internal = previous.internal && incoming.internal;
  if (previous.kind === "create" && incoming.kind === "remove") {
    changes.delete(key);
  } else if (previous.kind === "remove" && incoming.kind === "create") {
    changes.set(key, { ...incoming, kind: "modify", internal });
  } else {
    changes.set(key, { ...incoming, internal });
  }
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

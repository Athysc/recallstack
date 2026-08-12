export type AppView = "welcome" | "list" | "search" | "editor" | "calendar";
export type NavigationMode = "folder" | "all-tasks" | "outputs" | "search" | "calendar";

export interface CurrentViewState {
  view: AppView;
  mode: NavigationMode;
  workspace: string | null;
  level1: string | null;
  level2: string | null;
  archive: boolean;
  path: string | null;
}

export type ViewStateListener = (state: Readonly<CurrentViewState>, previous: Readonly<CurrentViewState>) => void;

export function createCurrentViewStore(initial?: Partial<CurrentViewState>) {
  let state: CurrentViewState = {
    view: "welcome",
    mode: "folder",
    workspace: null,
    level1: null,
    level2: null,
    archive: false,
    path: null,
    ...initial,
  };
  const listeners = new Set<ViewStateListener>();

  return {
    get(): Readonly<CurrentViewState> {
      return state;
    },
    update(patch: Partial<CurrentViewState>): Readonly<CurrentViewState> {
      const previous = state;
      state = { ...state, ...patch };
      if (Object.keys(patch).some(key => state[key as keyof CurrentViewState] !== previous[key as keyof CurrentViewState])) {
        listeners.forEach(listener => listener(state, previous));
      }
      return state;
    },
    subscribe(listener: ViewStateListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface LastFolderView {
  l1: string;
  l2: string | null;
  mode: "list" | "file";
  path: string | null;
}

export function parseLastFolderView(raw: string | null): LastFolderView | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LastFolderView>;
    if (!value || typeof value.l1 !== "string" || !value.l1) return null;
    if (value.l2 !== null && value.l2 !== undefined && typeof value.l2 !== "string") return null;
    if (value.mode !== "list" && value.mode !== "file") return null;
    if (value.mode === "file" && (typeof value.path !== "string" || !value.path)) return null;
    return { l1: value.l1, l2: value.l2 || null, mode: value.mode, path: value.mode === "file" ? value.path! : null };
  } catch {
    return null;
  }
}

export function serializeLastFolderView(view: LastFolderView): string {
  return JSON.stringify(view);
}

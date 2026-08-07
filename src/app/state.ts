export interface AppState {
  workspace: { rootName: string | null; activeName: string | null };
  navigation: { level1: string | null; level2: string | null; archive: boolean };
  editor: { path: string | null; savedContent: string | null; dirty: boolean };
  search: { query: string; generation: number };
  presentation: { enabled: boolean };
}

export function createInitialState(): AppState {
  return {
    workspace: { rootName: null, activeName: null },
    navigation: { level1: null, level2: null, archive: false },
    editor: { path: null, savedContent: null, dirty: false },
    search: { query: "", generation: 0 },
    presentation: { enabled: false },
  };
}

export const appState = createInitialState();

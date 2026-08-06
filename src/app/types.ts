export interface WorkspaceSummary {
  path: string;
  name: string;
  hasDataDirectory: boolean;
  noteCount: number;
}

export interface Entry {
  path: string;
  name: string;
  isDir: boolean;
  modifiedAt: number | null;
}

export interface Note {
  path: string;
  name: string;
  content: string;
}

export interface SearchResult {
  path: string;
  name: string;
  snippet: string;
}

export interface HealthReport {
  notes: number;
  brokenLinks: string[];
  orphanAssets: string[];
}

import { taskDisplayTitle } from "../tasks/filenames.ts";

export interface SearchIndexEntry {
  notesRelPath: string;
  name: string;
  content: string;
  title?: string | null;
  tags?: string[];
  kind?: string | null;
}

export interface SearchResult extends SearchIndexEntry {
  snippet: string;
  matchInName: boolean;
  folder?: string | null;
  status?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  modifiedAt?: number | null;
}

export interface NativeSearchResult {
  path: string;
  name: string;
  title?: string | null;
  snippet?: string | null;
  tags?: string[];
  kind?: string | null;
  folder?: string | null;
  status?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  modifiedAt?: number | null;
}

export interface NativeIndexedNote {
  path: string;
  name: string;
  title?: string | null;
  tags?: string[];
  kind?: string | null;
}

type IterableDirectory = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

export function mapNativeIndex(notes: readonly NativeIndexedNote[], prefix: string): SearchIndexEntry[] {
  return notes.map(note => ({
    notesRelPath: stripWorkspacePrefix(note.path, prefix), name: note.name, content: "",
    tags: note.tags || [], title: note.title, kind: note.kind,
  }));
}

export async function indexMarkdownDirectory(
  directory: FileSystemDirectoryHandle,
  prefix = "",
  isCurrent: () => boolean = () => true,
  target: SearchIndexEntry[] = [],
): Promise<SearchIndexEntry[]> {
  if (!isCurrent()) return target;
  for await (const entry of (directory as IterableDirectory).values()) {
    if (!isCurrent()) return target;
    if (entry.name.startsWith(".")) continue;
    if (entry.kind === "directory") {
      await indexMarkdownDirectory(entry, `${prefix}${entry.name}/`, isCurrent, target);
    } else if (entry.name.endsWith(".md")) {
      try {
        const content = await (await entry.getFile()).text();
        if (isCurrent()) target.push({ notesRelPath: `${prefix}${entry.name}`, name: entry.name, content });
      } catch { /* unreadable notes do not prevent the remaining index */ }
    }
  }
  return target;
}

const TAG_RE = /(^|\s)#[\p{L}\p{N}_-]+/gu;

// Extracted once per index update rather than rescanned on every tag-completion
// keystroke — see the 2026-08-14 typing-freeze investigation, where scanning
// every note's full content on every `#` autocomplete trigger blocked the main
// thread for however long the whole workspace's text took to regex-match.
export function extractTags(content: string): string[] {
  const tags = new Set<string>();
  (content.match(TAG_RE) || []).forEach(match => tags.add(match.trim().slice(1)));
  return [...tags];
}

export function upsertSearchEntry(index: SearchIndexEntry[], notesRelPath: string, content: string): SearchIndexEntry[] {
  const entry = { notesRelPath, name: notesRelPath.split("/").at(-1)!, content, tags: extractTags(content) };
  const position = index.findIndex(item => item.notesRelPath === notesRelPath);
  if (position === -1) return [...index, entry];
  const next = [...index];
  next[position] = entry;
  return next;
}

export function removeSearchEntry(index: SearchIndexEntry[], notesRelPath: string): SearchIndexEntry[] {
  return index.filter(entry => entry.notesRelPath !== notesRelPath);
}

export function searchLocalIndex(index: readonly SearchIndexEntry[], query: string): SearchResult[] {
  const normalized = query.toLowerCase();
  const results: SearchResult[] = [];
  for (const entry of index) {
    const matchInName = entry.name.toLowerCase().includes(normalized);
    const matchIndex = entry.content.toLowerCase().indexOf(normalized);
    if (!matchInName && matchIndex === -1) continue;
    let snippet = "";
    if (matchIndex !== -1) {
      const start = Math.max(0, matchIndex - 80);
      const end = Math.min(entry.content.length, matchIndex + normalized.length + 80);
      snippet = `${start > 0 ? "…" : ""}${entry.content.slice(start, end).replace(/\s+/g, " ")}${end < entry.content.length ? "…" : ""}`;
    }
    results.push({ ...entry, snippet, matchInName });
  }
  return results.sort((left, right) => Number(right.matchInName) - Number(left.matchInName));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripWorkspacePrefix(path: string, prefix: string): string {
  return path.replace(new RegExp(`^${escapeRegex(prefix)}/?`), "");
}

export function mapNativeSearchResults(
  results: readonly NativeSearchResult[],
  prefix: string,
  query: string,
): SearchResult[] {
  return results.map(result => ({
    notesRelPath: stripWorkspacePrefix(result.path, prefix), name: result.name, content: "",
    snippet: result.snippet || "", tags: result.tags || [], kind: result.kind,
    folder: result.folder, status: result.status, priority: result.priority, dueDate: result.dueDate,
    modifiedAt: result.modifiedAt, matchInName: result.name.toLowerCase().includes(query.toLowerCase()),
  }));
}

export function highlightMatch(text: string, query: string, escape: (value: string) => string): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return escape(text);
  return `${escape(text.slice(0, index))}<mark>${escape(text.slice(index, index + query.length))}</mark>${escape(text.slice(index + query.length))}`;
}

export function renderSearchResults(
  heading: HTMLElement,
  container: HTMLElement,
  results: SearchResult[],
  query: string,
  escape: (value: string) => string,
  onOpen: (result: SearchResult, event: MouseEvent) => void,
): void {
  heading.textContent = results.length ? `${results.length} result${results.length !== 1 ? "s" : ""} for "${query}"` : `No results for "${query}"`;
  if (!results.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No notes matched "<strong>${escape(query)}</strong>"</div></div>`;
    return;
  }
  container.replaceChildren();
  results.forEach(result => {
    const card = document.createElement("div");
    card.className = "search-result-card";
    const folder = result.notesRelPath.split("/").slice(0, -1).join("/");
    const name = taskDisplayTitle(result.name);
    const title = result.matchInName ? highlightMatch(name, query, escape) : escape(name);
    const snippet = result.snippet ? highlightMatch(result.snippet, query, escape) : "";
    const metadata = [result.kind, result.priority, result.status, result.dueDate, ...(result.tags || []).map(tag => `#${tag}`)]
      .filter(Boolean).map(value => `<span>${escape(value!)}</span>`).join("");
    card.innerHTML = `<div class="search-result-title">📄 ${title}</div><div class="search-result-path">${escape(folder)}/</div><div class="search-result-meta">${metadata}</div>${snippet ? `<div class="search-result-snippet">${snippet}</div>` : ""}`;
    card.addEventListener("click", event => onOpen(result, event));
    container.appendChild(card);
  });
}

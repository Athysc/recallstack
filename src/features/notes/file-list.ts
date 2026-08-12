import type { ListedFile } from "../../services/filesystem";

export type FileSortMode = "mtime" | "alpha";

export interface FileTypeGroup {
  key: string;
  label: string;
  icon: string;
  exts: ReadonlySet<string> | null;
}

export const BROWSER_VIEWABLE_EXTS = new Set([
  "jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico", "avif", "pdf",
  "mp3", "wav", "ogg", "flac", "aac", "m4a", "mp4", "webm", "ogv", "mov",
  "txt", "html", "htm", "xml", "json", "csv",
]);

export const FILE_TYPE_GROUPS: readonly FileTypeGroup[] = [
  { key: "markdown", label: "Markdown", icon: "📄", exts: new Set(["md"]) },
  { key: "image", label: "Images", icon: "🖼", exts: new Set(["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico", "avif"]) },
  { key: "pdf", label: "PDF", icon: "📋", exts: new Set(["pdf"]) },
  { key: "audio", label: "Audio", icon: "🎵", exts: new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a"]) },
  { key: "video", label: "Video", icon: "🎬", exts: new Set(["mp4", "webm", "ogv", "mov"]) },
  { key: "text", label: "Text & Code", icon: "📝", exts: new Set(["txt", "html", "htm", "xml", "json", "csv", "js", "ts", "py", "sh", "yaml", "yml", "toml", "ini", "css"]) },
  { key: "other", label: "Other Files", icon: "📦", exts: null },
];

export function fileExt(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function inboxFileGroup(name: string): FileTypeGroup {
  const extension = fileExt(name);
  return FILE_TYPE_GROUPS.find(group => group.exts === null || group.exts.has(extension))!;
}

export function sortFiles<T extends Pick<ListedFile, "name" | "mtime">>(files: T[], mode: FileSortMode): T[] {
  return [...files].sort(mode === "alpha"
    ? (left, right) => left.name.localeCompare(right.name)
    : (left, right) => right.mtime - left.mtime);
}

export function formatMtime(ms: number): string {
  const date = new Date(ms);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${months[date.getMonth()]} ${String(date.getDate()).padStart(2, " ")}, ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function appendTaskSection<T>(
  container: HTMLElement,
  title: string,
  items: T[],
  card: (item: T) => HTMLElement,
  escape: (value: string) => string,
  className = "",
): void {
  if (!items.length) return;
  const section = document.createElement("div");
  section.className = `tasks-section ${className}`.trim();
  const header = document.createElement("div");
  header.className = "tasks-section-header";
  header.innerHTML = `<span class="tasks-section-title">${escape(title)}</span><span class="tasks-section-count">${items.length} task${items.length !== 1 ? "s" : ""}</span>`;
  section.appendChild(header);
  items.forEach(item => section.appendChild(card(item)));
  container.appendChild(section);
}

export function appendSectionDivider(container: HTMLElement): void {
  const divider = document.createElement("div");
  divider.className = "tasks-section-divider";
  container.appendChild(divider);
}

export type TaskCountBuckets = Record<"rest" | "completed" | "qaReview" | "deployment" | "deployed" | "backlog", unknown[]>;

export function renderTaskCountBar(container: HTMLElement, buckets: TaskCountBuckets): void {
  const order: Array<[keyof TaskCountBuckets, string]> = [
    ["rest", "tcb-rest"], ["completed", "tcb-completed"], ["qaReview", "tcb-qa"],
    ["deployment", "tcb-deployment"], ["deployed", "tcb-deployed"], ["backlog", "tcb-backlog"],
  ];
  const total = order.reduce((sum, [key]) => sum + buckets[key].length, 0);
  container.replaceChildren();
  container.classList.toggle("hidden", total === 0);
  if (!total) return;
  order.forEach(([key, className]) => {
    const count = buckets[key].length;
    if (!count) return;
    const segment = document.createElement("div");
    segment.className = `tcb-segment ${className}`;
    segment.style.flexBasis = `${count / total * 100}%`;
    container.appendChild(segment);
  });
}

export function renderEmptyFileList(container: HTMLElement, icon: string, messageHtml: string): void {
  container.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-text">${messageHtml}</div></div>`;
}

export interface InboxRenderActions {
  openMarkdown(file: ListedFile, event: MouseEvent): void;
  openOther(file: ListedFile): void;
  deleteOther(file: ListedFile): void;
}

export function renderInboxFileGroups(
  container: HTMLElement,
  files: ListedFile[],
  mode: FileSortMode,
  escape: (value: string) => string,
  actions: InboxRenderActions,
): void {
  container.replaceChildren();
  const grouped = new Map(FILE_TYPE_GROUPS.map(group => [group.key, [] as ListedFile[]]));
  files.forEach(file => grouped.get(inboxFileGroup(file.name).key)!.push(file));

  FILE_TYPE_GROUPS.forEach(group => {
    const entries = sortFiles(grouped.get(group.key)!, mode);
    if (!entries.length) return;
    const section = document.createElement("div");
    section.className = "inbox-section";
    const header = document.createElement("div");
    header.className = "inbox-section-header";
    header.innerHTML = `<span class="inbox-section-title">${group.icon} ${escape(group.label)}</span><span class="inbox-section-count">${entries.length} file${entries.length !== 1 ? "s" : ""}</span>`;
    section.appendChild(header);

    entries.forEach(file => {
      const markdown = group.key === "markdown";
      const extension = `.${fileExt(file.name)}`;
      const displayName = markdown ? file.name.replace(/\.md$/i, "") : file.name.slice(0, -extension.length) || file.name;
      const card = document.createElement("div");
      card.className = "file-card";
      if (!markdown) {
        card.classList.add("file-card-inbox-nonmd");
        card.tabIndex = 0;
        card.title = "Double-click or press Enter to open";
      }
      card.innerHTML = `<span class="file-icon">${group.icon}</span><span class="file-name">${escape(displayName)}</span><span class="file-meta">${formatMtime(file.mtime)}</span><span class="file-ext">${escape(markdown ? ".md" : extension)}</span>${markdown ? "" : '<button class="btn-icon danger inbox-delete-btn" title="Delete file" tabindex="-1"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'}`;
      if (markdown) {
        card.addEventListener("click", event => actions.openMarkdown(file, event));
      } else {
        card.addEventListener("dblclick", () => actions.openOther(file));
        card.addEventListener("keydown", event => {
          if (event.key === "Enter") {
            event.preventDefault();
            actions.openOther(file);
          }
        });
        card.querySelector<HTMLButtonElement>(".inbox-delete-btn")!.addEventListener("click", event => {
          event.stopPropagation();
          actions.deleteOther(file);
        });
      }
      section.appendChild(card);
    });
    container.appendChild(section);
  });
}

export function renderNoteCards(
  container: HTMLElement,
  files: ListedFile[],
  escape: (value: string) => string,
  onOpen: (file: ListedFile, event: MouseEvent) => void,
): void {
  container.replaceChildren();
  files.forEach(file => {
    const card = document.createElement("div");
    card.className = "file-card";
    card.innerHTML = `<span class="file-icon">📄</span><span class="file-name">${escape(file.name.replace(/\.md$/, ""))}</span><span class="file-meta">${formatMtime(file.mtime)}</span><span class="file-ext">.md</span>`;
    card.addEventListener("click", event => onOpen(file, event));
    container.appendChild(card);
  });
}

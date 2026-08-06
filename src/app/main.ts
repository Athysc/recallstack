import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { backend } from "../services/backend";
import { renderMarkdown } from "../services/markdown";
import type { Entry, Note, SearchResult, WorkspaceSummary } from "./types";
import { MarkdownEditor } from "../features/notes/editor";
import "../ui/app.css";
import "../ui/desktop.css";

type View = "browse" | "search";

class RecallStackApp {
  private root = document.querySelector<HTMLElement>("#app")!;
  private workspace: WorkspaceSummary | null = null;
  private currentFolder = "";
  private currentNote: Note | null = null;
  private editor: MarkdownEditor | null = null;
  private savedContent = "";
  private view: View = "browse";
  private toastTimer = 0;

  async init(): Promise<void> {
    await listen<string[]>("workspace://changed", () => void this.refreshExternalChange());
    document.addEventListener("keydown", (event) => this.handleShortcuts(event));
    this.workspace = await backend.workspaceSummary();
    if (this.workspace) await this.showDesktop(); else await this.showWelcome();
  }

  private async showWelcome(): Promise<void> {
    const recents = await backend.recentWorkspaces();
    this.root.innerHTML = `<main class="welcome"><section class="welcome-card"><div class="logo">📒</div><h1>RecallStack</h1><p>A local-first desktop workspace. Your Markdown files remain the source of truth; RecallStack builds a native SQLite search index alongside them.</p><div class="button-row"><button class="button primary" id="open-workspace">Open workspace</button></div>${recents.length ? `<div class="recent-list"><h2>Recent workspaces</h2>${recents.map((item) => `<button data-workspace="${escapeAttr(item.path)}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.path)}</small></button>`).join("")}</div>` : ""}<p><small>Choose the folder that contains <code>Data/</code>.</small></p></section></main>`;
    this.root.querySelector("#open-workspace")?.addEventListener("click", () => void this.pickWorkspace());
    this.root.querySelectorAll<HTMLButtonElement>("[data-workspace]").forEach((button) => button.addEventListener("click", () => void this.openWorkspace(button.dataset.workspace!)));
  }

  private async pickWorkspace(): Promise<void> {
    const selected = await open({ directory: true, multiple: false, title: "Open RecallStack workspace" });
    if (typeof selected === "string") await this.openWorkspace(selected);
  }

  private async openWorkspace(path: string): Promise<void> {
    try { this.workspace = await backend.setWorkspace(path); await this.showDesktop(); this.notify(`Opened ${this.workspace.name}`); }
    catch (error) { this.notify(String(error), true); }
  }

  private async showDesktop(): Promise<void> {
    this.root.innerHTML = `<div class="desktop recallstack-shell"><header class="appbar"><span class="title">📒 RecallStack</span><span class="crumb">${escapeHtml(this.workspace!.path)}</span><span class="spacer"></span><button class="icon-button" id="workspace-folder" title="Reveal workspace">▣</button><input class="search" id="search" placeholder="Search notes…  Ctrl+K" /><button class="icon-button" id="command" title="Command palette (Ctrl+K)">⌘</button><button class="icon-button" id="tools" title="Tools">⋯</button><button class="icon-button close-app" id="close-app" title="Close RecallStack">×</button></header><nav id="folders" class="nav-row"></nav><main class="content"><section class="pane file-pane" id="file-pane"><div class="pane-header"><span id="file-heading">Files</span><button class="button primary" id="new-note">+ New</button></div><div id="files" class="file-list"></div></section><section class="pane editor-pane hidden" id="editor-pane"><div class="note-toolbar"><button class="button" id="back-to-files">← Files</button><input class="note-title" id="note-title" disabled placeholder="Select a note" /><span class="dirty hidden" id="dirty">Unsaved</span><button class="button primary" id="save" disabled>Save</button><button class="button danger" id="trash" disabled>Trash</button></div><div class="split"><div id="editor" class="editor"><div class="empty">Select a note to begin.</div></div><article id="preview" class="preview"><div class="empty">Markdown preview</div></article></div></section></main></div><div id="toast" class="toast hidden"></div>`;
    this.root.querySelector("#search")?.addEventListener("input", (event) => void this.search((event.target as HTMLInputElement).value));
    this.root.querySelector("#command")?.addEventListener("click", () => this.showCommandPalette());
    this.root.querySelector("#tools")?.addEventListener("click", () => this.showCommandPalette(true));
    this.root.querySelector("#new-note")?.addEventListener("click", () => void this.newNote());
    this.root.querySelector("#save")?.addEventListener("click", () => void this.save());
    this.root.querySelector("#trash")?.addEventListener("click", () => void this.trash());
    this.root.querySelector("#workspace-folder")?.addEventListener("click", () => void backend.reveal());
    this.root.querySelector("#close-app")?.addEventListener("click", () => void getCurrentWindow().close());
    this.root.querySelector("#back-to-files")?.addEventListener("click", () => { this.currentNote = null; this.renderEmptyEditor(); });
    await this.renderFolders(); await this.renderFiles();
  }

  private async renderFolders(): Promise<void> {
    const folders = document.querySelector<HTMLElement>("#folders")!;
    const entries = await backend.listEntries();
    const dirs = entries.filter((entry) => entry.isDir);
    folders.innerHTML = `<button class="folder ${this.currentFolder === "" ? "active" : ""}" data-folder="">⌂ All notes</button>${dirs.map((entry) => `<button class="folder ${this.currentFolder === entry.path ? "active" : ""}" data-folder="${escapeAttr(entry.path)}">▸ ${escapeHtml(entry.name)}</button>`).join("")}`;
    folders.querySelectorAll<HTMLButtonElement>("[data-folder]").forEach((button) => button.addEventListener("click", () => { this.currentFolder = button.dataset.folder ?? ""; this.currentNote = null; void this.renderFolders(); void this.renderFiles(); this.renderEmptyEditor(); }));
  }

  private async renderFiles(): Promise<void> {
    const files = document.querySelector<HTMLElement>("#files")!;
    const heading = document.querySelector<HTMLElement>("#file-heading")!;
    heading.textContent = this.currentFolder || "All notes";
    const entries = await backend.listEntries(this.currentFolder || undefined, this.currentFolder === "");
    const folders = entries.filter((entry) => entry.isDir);
    const notes = entries.filter((entry) => !entry.isDir);
    files.innerHTML = (folders.length || notes.length)
      ? `${folders.map((entry) => `<button class="file folder-card" data-open-folder="${escapeAttr(entry.path)}">📁 <strong>${escapeHtml(entry.name)}</strong><small>Open folder</small></button>`).join("")}${notes.map((entry) => this.fileButton(entry)).join("")}`
      : `<div class="empty">No notes here.</div>`;
    files.querySelectorAll<HTMLButtonElement>("[data-open-folder]").forEach((button) => button.addEventListener("click", () => { this.currentFolder = button.dataset.openFolder!; this.currentNote = null; void this.renderFolders(); void this.renderFiles(); this.renderEmptyEditor(); }));
    files.querySelectorAll<HTMLButtonElement>("[data-note]").forEach((button) => button.addEventListener("click", () => void this.openNote(button.dataset.note!)));
  }

  private fileButton(entry: Entry): string {
    const current = this.currentNote?.path === entry.path ? "active" : "";
    const date = entry.modifiedAt ? new Date(entry.modifiedAt * 1000).toLocaleDateString() : "";
    return `<button class="file ${current}" data-note="${escapeAttr(entry.path)}">${escapeHtml(entry.name.replace(/\.md$/i, ""))}<time>${date}</time></button>`;
  }

  private async openNote(path: string): Promise<void> {
    try { this.currentNote = await backend.readNote(path); this.savedContent = this.currentNote.content; this.renderNote(); await this.renderFiles(); }
    catch (error) { this.notify(String(error), true); }
  }

  private renderNote(): void {
    if (!this.currentNote) return this.renderEmptyEditor();
    document.querySelector("#file-pane")?.classList.add("hidden");
    document.querySelector("#editor-pane")?.classList.remove("hidden");
    const editorParent = document.querySelector<HTMLElement>("#editor")!;
    const preview = document.querySelector<HTMLElement>("#preview")!;
    const title = document.querySelector<HTMLInputElement>("#note-title")!;
    title.disabled = false; title.value = this.currentNote.name; title.onchange = () => this.notify("Renaming is coming next; use the current filename for this save.");
    document.querySelector<HTMLButtonElement>("#save")!.disabled = false;
    document.querySelector<HTMLButtonElement>("#trash")!.disabled = false;
    editorParent.innerHTML = "";
    this.editor = new MarkdownEditor(editorParent, (content) => { preview.innerHTML = renderMarkdown(content); this.updateDirty(); });
    this.editor.setValue(this.currentNote.content); preview.innerHTML = renderMarkdown(this.currentNote.content);
  }

  private renderEmptyEditor(): void {
    document.querySelector("#file-pane")?.classList.remove("hidden");
    document.querySelector("#editor-pane")?.classList.add("hidden");
    document.querySelector<HTMLElement>("#editor")!.innerHTML = `<div class="empty">Select a note to begin.</div>`;
    document.querySelector<HTMLElement>("#preview")!.innerHTML = `<div class="empty">Markdown preview</div>`;
    const title = document.querySelector<HTMLInputElement>("#note-title")!; title.value = ""; title.disabled = true;
    document.querySelector<HTMLButtonElement>("#save")!.disabled = true; document.querySelector<HTMLButtonElement>("#trash")!.disabled = true;
    this.editor = null;
  }

  private updateDirty(): void { document.querySelector("#dirty")?.classList.toggle("hidden", this.editor?.value() === this.savedContent); }

  private async newNote(): Promise<void> {
    const raw = window.prompt("New note name (relative to the current folder)");
    if (!raw?.trim()) return;
    const name = raw.trim().endsWith(".md") ? raw.trim() : `${raw.trim()}.md`;
    const path = [this.currentFolder, name].filter(Boolean).join("/");
    try { const note = await backend.createNote(path, `# ${name.replace(/\.md$/i, "")}\n\n`); this.currentNote = note; this.savedContent = note.content; this.renderNote(); await this.renderFiles(); this.editor?.focus(); }
    catch (error) { this.notify(String(error), true); }
  }

  private async save(): Promise<void> {
    if (!this.currentNote || !this.editor) return;
    try { const content = this.editor.value(); await backend.writeNote(this.currentNote.path, content); this.currentNote.content = content; this.savedContent = content; this.updateDirty(); await this.renderFiles(); this.notify("Saved"); }
    catch (error) { this.notify(String(error), true); }
  }

  private async trash(): Promise<void> {
    if (!this.currentNote || !confirm(`Move “${this.currentNote.name}” to RecallStack trash?`)) return;
    try { await backend.moveToTrash(this.currentNote.path); this.currentNote = null; this.renderEmptyEditor(); await this.renderFiles(); this.notify("Moved to RecallStack trash"); }
    catch (error) { this.notify(String(error), true); }
  }

  private async search(query: string): Promise<void> {
    if (!query.trim()) { if (this.view === "search") { this.view = "browse"; await this.renderFiles(); } return; }
    try { const results = await backend.search(query); this.view = "search"; this.renderSearchResults(results); }
    catch (error) { this.notify(String(error), true); }
  }

  private renderSearchResults(results: SearchResult[]): void {
    const files = document.querySelector<HTMLElement>("#files")!;
    document.querySelector<HTMLElement>("#file-heading")!.textContent = "Search results";
    files.innerHTML = results.length ? results.map((result) => `<button class="file" data-note="${escapeAttr(result.path)}"><strong>${escapeHtml(result.name)}</strong><small>${result.snippet}</small></button>`).join("") : `<div class="empty">No matching notes.</div>`;
    files.querySelectorAll<HTMLButtonElement>("[data-note]").forEach((button) => button.addEventListener("click", () => void this.openNote(button.dataset.note!)));
  }

  private showCommandPalette(tools = false): void {
    document.querySelector("#command-palette")?.remove();
    const commands: Array<[string, () => void | Promise<void>]> = [["Open workspace…", () => void this.pickWorkspace()], ["Create note", () => void this.newNote()], ["Rebuild search index", async () => this.notify(`Indexed ${await backend.rebuildIndex()} notes`)], ["Backup workspace", async () => { const result = await backend.backup(); this.notify(`Backup created (${result.files} files)`); }], ["Check workspace health", async () => { const report = await backend.health(); this.notify(`${report.notes} notes · ${report.brokenLinks.length} broken links · ${report.orphanAssets.length} orphan assets`); }], ["Reveal current note", () => this.currentNote ? void backend.reveal(this.currentNote.path) : undefined]];
    const palette = document.createElement("div"); palette.id = "command-palette"; palette.className = "command";
    palette.innerHTML = `<input autofocus placeholder="${tools ? "Tools" : "Type a command"}" />${commands.map(([label], index) => `<button data-command="${index}">${label}</button>`).join("")}`;
    document.body.append(palette); const input = palette.querySelector<HTMLInputElement>("input")!; input.focus();
    palette.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => button.addEventListener("click", () => { palette.remove(); void commands[Number(button.dataset.command)]?.[1](); }));
    input.addEventListener("input", () => palette.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => button.classList.toggle("hidden", !button.textContent!.toLowerCase().includes(input.value.toLowerCase()))));
    input.addEventListener("keydown", (event) => { if (event.key === "Escape") palette.remove(); });
  }

  private handleShortcuts(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); this.showCommandPalette(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void this.save(); }
  }

  private async refreshExternalChange(): Promise<void> { if (this.workspace && this.view === "browse") await this.renderFiles(); }
  private notify(message: string, error = false): void { const toast = document.querySelector<HTMLElement>("#toast"); if (!toast) return; toast.textContent = message.replace(/^Error: /, ""); toast.classList.toggle("error", error); toast.classList.remove("hidden"); window.clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3600); }
}

function escapeHtml(value: string): string { const element = document.createElement("div"); element.textContent = value; return element.innerHTML; }
function escapeAttr(value: string): string { return escapeHtml(value).replace(/"/g, "&quot;"); }

const application = new RecallStackApp();
void application.init().catch((error) => {
  document.querySelector<HTMLElement>("#app")!.innerHTML = `<main class="welcome"><section class="welcome-card"><div class="logo">⚠️</div><h1>RecallStack could not start</h1><p>${escapeHtml(String(error))}</p><div class="button-row"><button class="button primary" id="retry">Retry</button><button class="button" id="close">Close application</button></div></section></main>`;
  document.querySelector("#retry")?.addEventListener("click", () => location.reload());
  document.querySelector("#close")?.addEventListener("click", () => void getCurrentWindow().close());
});

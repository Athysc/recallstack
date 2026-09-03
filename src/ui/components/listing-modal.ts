import { tabJumpCodes } from "./quick-tab-switcher.ts";
import { fuzzyScore } from "../../features/commands/ranking.ts";

export type ListingSort = "alpha" | "mtime";

/** Characters typed before the fuzzy filter engages. */
const MIN_FILTER_LENGTH = 2;

/** A row survives the filter when the query fuzzy-matches its title or subtitle. */
function rowMatchesFilter(query: string, row: ListingRow): boolean {
  return fuzzyScore(query, row.title) !== null
    || (row.subtitle !== undefined && fuzzyScore(query, row.subtitle) !== null);
}

export interface ListingRow {
  id: number;
  title: string;
  subtitle?: string;
  /** e.g. `"priority-high"` — color-codes the row's left border. */
  priorityClass?: string;
  /** Trailing action-button label. Omit for no action button. */
  actionLabel?: string;
  /** Styles the action button; `"archive"` / `"restore"` get the peach accent. */
  actionKind?: "working" | "task" | "archive" | "restore";
}

export interface ListingSection {
  /** `null` renders the rows with no heading (single flat list). */
  title: string | null;
  rows: ListingRow[];
}

export interface ListingModalElements {
  overlay: HTMLElement;
  dialog: HTMLElement;
  titleEl: HTMLElement;
  filterInput: HTMLInputElement;
  filterClearBtn: HTMLButtonElement;
  sortBtn: HTMLButtonElement;
  archivedBtn: HTMLButtonElement;
  createBtn: HTMLButtonElement;
  results: HTMLElement;
  typed: HTMLElement;
}

export interface ListingModalOptions {
  title: string;
  sections: ListingSection[];
  sort: ListingSort;
  /** Provide (with `onArchivedToggle`) to show the archived toggle button. */
  archived?: boolean;
  onActivate(id: number, pinned: boolean): Promise<boolean>;
  onSortChange(sort: ListingSort): Promise<ListingSection[]>;
  onArchivedToggle?(next: boolean): Promise<ListingSection[]>;
  onRowAction?(id: number): Promise<ListingSection[] | null>;
  /** Provide to show the "New" button (and enable Ctrl+N) in the header. The
   *  modal closes before this runs, so it owns whatever workflow follows. */
  onCreate?(): void | Promise<void>;
}

interface FlatRow extends ListingRow {
  code: string;
}

const SORT_LABEL: Record<ListingSort, string> = { alpha: "Sort: A–Z", mtime: "Sort: Modified" };

export function assignRowCodes(sections: ListingSection[]): FlatRow[] {
  const rows = sections.flatMap(section => section.rows);
  const codes = tabJumpCodes(rows.length);
  return rows.map((row, index) => ({ ...row, code: codes[index] || "" }));
}

export class ListingModalController {
  private readonly els: ListingModalElements;
  private options: ListingModalOptions | null = null;
  private sections: ListingSection[] = [];
  private flat: FlatRow[] = [];
  private selected = 0;
  private typed = "";
  /** Fuzzy filter text from the header search box (raw, may be under MIN_FILTER_LENGTH). */
  private query = "";
  private sort: ListingSort = "mtime";
  private archived = false;
  private previousFocus: HTMLElement | null = null;
  private busy = false;

  constructor(els: ListingModalElements) {
    this.els = els;
    els.overlay.addEventListener("click", event => {
      if (event.target === els.overlay) this.close();
    });
    els.overlay.addEventListener("keydown", event => this.handleKeydown(event));
    els.sortBtn.addEventListener("click", () => void this.toggleSort());
    els.archivedBtn.addEventListener("click", () => void this.toggleArchived());
    els.createBtn.addEventListener("click", () => void this.triggerCreate());
    els.filterInput.addEventListener("input", () => this.setFilter(els.filterInput.value));
    els.filterInput.addEventListener("keydown", event => this.handleFilterKeydown(event));
    els.filterClearBtn.addEventListener("click", () => this.clearFilter(true));
  }

  isOpen(): boolean {
    return !this.els.overlay.classList.contains("hidden");
  }

  open(options: ListingModalOptions): boolean {
    if (this.busy) return false;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.options = options;
    this.sections = options.sections;
    this.sort = options.sort;
    this.archived = options.archived ?? false;
    this.selected = 0;
    this.typed = "";
    this.resetFilter();
    this.els.titleEl.textContent = options.title;
    this.els.archivedBtn.classList.toggle("hidden", !options.onArchivedToggle);
    this.els.createBtn.classList.toggle("hidden", !options.onCreate);
    this.els.overlay.classList.remove("hidden");
    this.render();
    requestAnimationFrame(() => this.els.results.focus());
    return true;
  }

  /** Re-render with a freshly built section set, preserving sort/archived state. */
  refresh(sections: ListingSection[]): void {
    if (!this.isOpen() || !this.options || this.busy) return;
    this.sections = sections;
    if (!sections.some(section => section.rows.length)) { this.close(); return; }
    this.render();
  }

  close(restoreFocus = true): void {
    if (!this.isOpen()) return;
    const focus = this.previousFocus;
    this.els.overlay.classList.add("hidden");
    this.options = null;
    this.sections = [];
    this.flat = [];
    this.previousFocus = null;
    this.typed = "";
    this.els.typed.textContent = "";
    this.resetFilter();
    if (restoreFocus) focus?.focus();
  }

  private render(): void {
    const sections = this.filteredSections();
    this.flat = assignRowCodes(sections);
    this.selected = Math.min(Math.max(this.selected, 0), Math.max(0, this.flat.length - 1));
    this.els.sortBtn.dataset.sort = this.sort;
    this.els.sortBtn.lastElementChild!.textContent = SORT_LABEL[this.sort];
    this.els.archivedBtn.classList.toggle("is-on", this.archived);
    this.els.archivedBtn.lastElementChild!.textContent = this.archived ? "Showing archived" : "Show archived";

    this.els.results.replaceChildren();
    let flatIndex = 0;
    for (const section of sections) {
      if (!section.rows.length) continue;
      if (section.title) {
        const heading = document.createElement("div");
        heading.className = "listing-section-title";
        heading.textContent = section.title;
        this.els.results.appendChild(heading);
      }
      for (const row of section.rows) {
        const index = flatIndex++;
        const coded = this.flat[index];
        const el = document.createElement("button");
        el.type = "button";
        el.id = `listing-row-${row.id}`;
        el.className = `listing-row${row.priorityClass ? " " + row.priorityClass : ""}`;
        el.setAttribute("role", "option");
        el.setAttribute("aria-selected", String(index === this.selected));

        const code = document.createElement("kbd");
        code.className = "listing-row-code";
        code.textContent = coded.code;
        const details = document.createElement("span");
        details.className = "listing-row-details";
        const title = document.createElement("span");
        title.className = "listing-row-title";
        title.textContent = row.title || "Untitled";
        details.appendChild(title);
        if (row.subtitle) {
          const small = document.createElement("small");
          small.textContent = row.subtitle;
          details.appendChild(small);
        }
        el.append(code, details);
        if (row.actionLabel && this.options?.onRowAction) {
          const action = document.createElement("span");
          action.className = `listing-row-action${row.actionKind === "archive" || row.actionKind === "restore" ? " action-archive" : ""}`;
          action.setAttribute("role", "button");
          action.textContent = row.actionLabel;
          action.title = row.actionLabel;
          action.addEventListener("mousedown", event => event.preventDefault());
          action.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            void this.runRowAction(row.id);
          });
          el.appendChild(action);
        }
        el.addEventListener("mouseenter", () => {
          this.selected = index;
          this.renderSelection();
        });
        el.addEventListener("click", () => void this.choose(index, false));
        this.els.results.appendChild(el);
      }
    }
    if (!this.flat.length && this.activeQuery()) {
      const empty = document.createElement("div");
      empty.className = "listing-empty";
      empty.textContent = `No matches for “${this.activeQuery()}”`;
      this.els.results.appendChild(empty);
    }
    this.renderSelection();
  }

  /** The trimmed query once it is long enough to filter, else `""`. */
  private activeQuery(): string {
    const query = this.query.trim();
    return query.length >= MIN_FILTER_LENGTH ? query : "";
  }

  /** All sections, or the fuzzy-filtered subset once the query is long enough.
   *  Sort / archived toggles rebuild `this.sections`, so the filter re-applies
   *  on top of whichever set (current or archived) is loaded. */
  private filteredSections(): ListingSection[] {
    const query = this.activeQuery();
    if (!query) return this.sections;
    const filtered: ListingSection[] = [];
    for (const section of this.sections) {
      const rows = section.rows.filter(row => rowMatchesFilter(query, row));
      if (rows.length) filtered.push({ title: section.title, rows });
    }
    return filtered;
  }

  private setFilter(value: string): void {
    if (value === this.query) return;
    this.query = value;
    this.els.filterClearBtn.classList.toggle("hidden", value.length === 0);
    this.selected = 0;
    this.typed = "";
    if (this.isOpen()) this.render();
  }

  private clearFilter(focusInput: boolean): void {
    this.els.filterInput.value = "";
    this.setFilter("");
    if (focusInput) this.els.filterInput.focus();
  }

  private resetFilter(): void {
    this.query = "";
    this.els.filterInput.value = "";
    this.els.filterClearBtn.classList.add("hidden");
  }

  private handleFilterKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (!this.query) return; // empty box — let the overlay handler close the modal
      event.preventDefault();
      event.stopPropagation();
      this.clearFilter(true);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (this.flat.length) void this.choose(0, event.ctrlKey || event.metaKey);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      this.selected = 0;
      this.els.results.focus();
      this.renderSelection();
    }
  }

  private renderSelection(): void {
    const rows = this.els.results.querySelectorAll<HTMLElement>('[role="option"]');
    rows.forEach((row, index) => row.setAttribute("aria-selected", String(index === this.selected)));
    rows[this.selected]?.scrollIntoView({ block: "nearest" });
    this.els.typed.textContent = this.typed ? `Jump: ${this.typed}` : "";
  }

  private move(delta: number): void {
    if (!this.flat.length) return;
    this.selected = (this.selected + delta + this.flat.length) % this.flat.length;
    this.typed = "";
    this.renderSelection();
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.isOpen()) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void this.choose(this.selected, true);
      return;
    }
    if (this.options?.onCreate && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      event.stopPropagation();
      void this.triggerCreate();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === " " || event.code === "Space")) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    // Let Tab move focus naturally between the results list and the header
    // buttons; only treat list-navigation keys as ours when the list is focused.
    if (event.key === "Tab") return;
    if (document.activeElement !== this.els.results) return;
    // Modifier chords (Ctrl+T / Ctrl+W to switch listings, Ctrl+L, Ctrl+K, …)
    // belong to the global keydown handler. Don't consume them here — just bail
    // out so they aren't mistaken for a jump-code letter below and still reach
    // the document.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.key === "ArrowDown" || key === "j") { event.preventDefault(); event.stopPropagation(); this.move(1); return; }
    if (event.key === "ArrowUp" || key === "k") { event.preventDefault(); event.stopPropagation(); this.move(-1); return; }
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void this.choose(this.selected, false); return; }
    if (!/^[a-z]$/i.test(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const letter = event.key.toUpperCase();
    const appended = this.typed + letter;
    this.typed = this.flat.some(row => row.code.startsWith(appended)) ? appended : letter;
    const match = this.flat.findIndex(row => row.code === this.typed);
    if (match >= 0) { void this.choose(match, false); return; }
    const prefix = this.flat.findIndex(row => row.code.startsWith(this.typed));
    if (prefix >= 0) this.selected = prefix;
    else this.typed = "";
    this.renderSelection();
  }

  private async choose(index: number, pinned: boolean): Promise<void> {
    const row = this.flat[index];
    const options = this.options;
    if (!row || !options || this.busy) return;
    this.busy = true;
    const restoreFocus = this.previousFocus;
    this.els.overlay.classList.add("hidden");
    try {
      const activated = await options.onActivate(row.id, pinned);
      if (!activated) restoreFocus?.focus();
    } finally {
      this.options = null;
      this.sections = [];
      this.flat = [];
      this.previousFocus = null;
      this.typed = "";
      this.els.typed.textContent = "";
      this.busy = false;
    }
  }

  private async toggleSort(): Promise<void> {
    if (!this.options || this.busy) return;
    this.busy = true;
    const options = this.options;
    try {
      const next = this.sort === "alpha" ? "mtime" : "alpha";
      const sections = await options.onSortChange(next);
      if (!this.isOpen() || this.options !== options) return;
      this.sort = next;
      this.sections = sections;
      this.render();
      this.els.results.focus();
    } finally {
      this.busy = false;
    }
  }

  private async toggleArchived(): Promise<void> {
    if (!this.options?.onArchivedToggle || this.busy) return;
    this.busy = true;
    const options = this.options;
    try {
      const next = !this.archived;
      const sections = await options.onArchivedToggle!(next);
      if (!this.isOpen() || this.options !== options) return;
      this.archived = next;
      this.sections = sections;
      this.selected = 0;
      this.render();
      this.els.results.focus();
    } finally {
      this.busy = false;
    }
  }

  /** Close the modal, then hand off to the host's "create new item" workflow. */
  private async triggerCreate(): Promise<void> {
    const onCreate = this.options?.onCreate;
    if (!onCreate || this.busy) return;
    this.close();
    await onCreate();
  }

  private async runRowAction(id: number): Promise<void> {
    if (!this.options?.onRowAction || this.busy) return;
    this.busy = true;
    const options = this.options;
    let emptied = false;
    try {
      const sections = await options.onRowAction!(id);
      if (!sections || !this.isOpen() || this.options !== options) return;
      this.sections = sections;
      if (!sections.some(section => section.rows.length)) { emptied = true; return; }
      this.render();
      this.els.results.focus();
    } finally {
      this.busy = false;
      if (emptied) this.close();
    }
  }
}

const JUMP_ALPHABET = [..."ASDFGHLQWERTYUIOPZCVBNM"];
const SINGLE_CODE_LIMIT = 16;

export interface QuickTabItem {
  id: number;
  title: string;
  path: string;
  kind: string;
  dirty: boolean;
}

export interface CodedQuickTabItem extends QuickTabItem {
  code: string;
}

export interface QuickTabSwitcherElements {
  overlay: HTMLElement;
  dialog: HTMLElement;
  list: HTMLElement;
  typedCode: HTMLElement;
}

export interface QuickTabSwitcherOptions {
  items: QuickTabItem[];
  activeId: number | null;
  activate(id: number, pinned?: boolean): Promise<boolean>;
  closeItem(id: number): Promise<{ items: QuickTabItem[]; activeId: number | null } | null>;
}

/**
 * Produce prefix-free one- or two-letter codes so an exact match can activate
 * immediately without waiting to see whether another key follows.
 */
export function tabJumpCodes(count: number): string[] {
  const boundedCount = Math.max(0, Math.floor(count));
  if (boundedCount <= JUMP_ALPHABET.length) return JUMP_ALPHABET.slice(0, boundedCount);
  if (boundedCount <= SINGLE_CODE_LIMIT + (JUMP_ALPHABET.length - SINGLE_CODE_LIMIT) * JUMP_ALPHABET.length) {
    const singles = JUMP_ALPHABET.slice(0, SINGLE_CODE_LIMIT);
    const prefixes = JUMP_ALPHABET.slice(SINGLE_CODE_LIMIT);
    const pairs = prefixes.flatMap(prefix => JUMP_ALPHABET.map(letter => prefix + letter));
    return [...singles, ...pairs].slice(0, boundedCount);
  }
  return JUMP_ALPHABET.flatMap(first => JUMP_ALPHABET.map(second => first + second)).slice(0, boundedCount);
}

export function codeQuickTabs(items: QuickTabItem[]): CodedQuickTabItem[] {
  const codes = tabJumpCodes(items.length);
  return items.map((item, index) => ({ ...item, code: codes[index] || "" }));
}

export class QuickTabSwitcherController {
  private readonly elements: QuickTabSwitcherElements;
  private items: CodedQuickTabItem[] = [];
  private selectedIndex = 0;
  private typed = "";
  private previousFocus: HTMLElement | null = null;
  private activate: ((id: number, pinned?: boolean) => Promise<boolean>) | null = null;
  private closeItem: QuickTabSwitcherOptions["closeItem"] | null = null;
  private choosing = false;

  constructor(elements: QuickTabSwitcherElements) {
    this.elements = elements;
    elements.overlay.addEventListener("click", event => {
      if (event.target === elements.overlay) this.close();
    });
    elements.overlay.addEventListener("keydown", event => this.handleKeydown(event));
  }

  isOpen(): boolean {
    return !this.elements.overlay.classList.contains("hidden");
  }

  open(options: QuickTabSwitcherOptions): boolean {
    if (this.choosing || !options.items.length) return false;
    this.previousFocus = typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.items = codeQuickTabs(options.items);
    this.selectedIndex = Math.max(0, this.items.findIndex(item => item.id === options.activeId));
    this.typed = "";
    this.activate = options.activate;
    this.closeItem = options.closeItem;
    this.elements.overlay.classList.remove("hidden");
    this.render();
    requestAnimationFrame(() => this.elements.list.focus());
    return true;
  }

  close(restoreFocus = true): void {
    if (!this.isOpen() || this.choosing) return;
    const focus = this.previousFocus;
    this.elements.overlay.classList.add("hidden");
    this.items = [];
    this.activate = null;
    this.closeItem = null;
    this.previousFocus = null;
    this.typed = "";
    this.elements.typedCode.textContent = "";
    if (restoreFocus) focus?.focus();
  }

  private render(): void {
    this.elements.list.replaceChildren();
    this.items.forEach((item, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.id = `quick-tab-option-${item.id}`;
      row.className = "quick-tab-item";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(index === this.selectedIndex));

      const code = document.createElement("kbd");
      code.className = "quick-tab-code";
      code.textContent = item.code;
      const details = document.createElement("span");
      details.className = "quick-tab-details";
      const title = document.createElement("span");
      title.className = "quick-tab-title";
      title.textContent = item.title || "Untitled";
      const path = document.createElement("small");
      path.textContent = item.path || "Unsaved file";
      details.append(title, path);
      const kind = document.createElement("span");
      kind.className = "quick-tab-kind";
      kind.textContent = `${item.dirty ? "●  " : ""}${item.kind}`;
      row.append(code, details, kind);
      row.addEventListener("mouseenter", () => {
        this.selectedIndex = index;
        this.renderSelection();
      });
      row.addEventListener("click", () => void this.choose(index));
      this.elements.list.appendChild(row);
    });
    this.renderSelection();
  }

  private renderSelection(): void {
    this.elements.list.querySelectorAll<HTMLElement>('[role="option"]').forEach((row, index) => {
      row.setAttribute("aria-selected", String(index === this.selectedIndex));
    });
    const selected = this.items[this.selectedIndex];
    this.elements.list.setAttribute("aria-activedescendant", selected ? `quick-tab-option-${selected.id}` : "");
    this.elements.list.children[this.selectedIndex]?.scrollIntoView({ block: "nearest" });
    this.elements.typedCode.textContent = this.typed ? `Jump: ${this.typed}` : "Type a displayed code to jump instantly";
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.isOpen()) return;
    if ((event.ctrlKey || event.metaKey) && (event.key === " " || event.code === "Space")) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void this.choose(this.selectedIndex, true);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const key = event.key.toLowerCase();
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || key === "j" || key === "k") {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === "ArrowDown" || key === "j" ? 1 : -1;
      this.selectedIndex = (this.selectedIndex + delta + this.items.length) % this.items.length;
      this.typed = "";
      this.renderSelection();
      return;
    }
    if (key === "x" && this.closeItem) {
      event.preventDefault();
      event.stopPropagation();
      void this.closeSelected();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void this.choose(this.selectedIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!/^[a-z]$/i.test(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const letter = event.key.toUpperCase();
    const appended = this.typed + letter;
    this.typed = this.items.some(item => item.code.startsWith(appended)) ? appended : letter;
    const match = this.items.findIndex(item => item.code === this.typed);
    if (match >= 0) {
      void this.choose(match);
      return;
    }
    const prefix = this.items.findIndex(item => item.code.startsWith(this.typed));
    if (prefix >= 0) this.selectedIndex = prefix;
    else this.typed = "";
    this.renderSelection();
  }

  private async choose(index: number, pinned = false): Promise<void> {
    const item = this.items[index];
    const activate = this.activate;
    if (!item || !activate || this.choosing) return;
    this.choosing = true;
    const restoreFocus = this.previousFocus;
    this.elements.overlay.classList.add("hidden");
    try {
      const activated = await activate(item.id, pinned);
      if (!activated) restoreFocus?.focus();
    } finally {
      this.items = [];
      this.activate = null;
      this.closeItem = null;
      this.previousFocus = null;
      this.typed = "";
      this.elements.typedCode.textContent = "";
      this.choosing = false;
    }
  }

  private async closeSelected(): Promise<void> {
    const item = this.items[this.selectedIndex];
    const closeItem = this.closeItem;
    if (!item || !closeItem || this.choosing) return;
    this.choosing = true;
    try {
      const state = await closeItem(item.id);
      if (!state) return;
      if (!state.items.length) {
        this.elements.overlay.classList.add("hidden");
        this.items = [];
        this.activate = null;
        this.closeItem = null;
        this.previousFocus = null;
        this.typed = "";
        this.elements.typedCode.textContent = "";
        return;
      }
      this.items = codeQuickTabs(state.items);
      this.selectedIndex = Math.min(this.selectedIndex, this.items.length - 1);
      this.typed = "";
      this.render();
      this.elements.list.focus();
    } finally {
      this.choosing = false;
    }
  }
}

import type { MarkdownEditorAdapter, MarkdownEditorOptions } from "./markdown-editor";

interface QueuedListener {
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: AddEventListenerOptions | boolean;
}

const unloadedView = { requestMeasure() {} };

/**
 * Keeps the welcome/workspace-list shell independent of CodeMirror's sizeable
 * dependency graph. The real editor is imported when the first document opens.
 */
export class LazyMarkdownEditorAdapter {
  readonly #source: HTMLElement;
  readonly #listeners: QueuedListener[] = [];
  readonly #options: MarkdownEditorOptions;
  #adapter: MarkdownEditorAdapter | null = null;
  #loading: Promise<MarkdownEditorAdapter> | null = null;
  #value = "";
  #selectionStart = 0;
  #selectionEnd = 0;
  #scrollTop = 0;

  constructor(source: HTMLElement, options: MarkdownEditorOptions = {}) {
    this.#source = source;
    this.#options = { ...options };
    this.#value = source.textContent || "";
  }

  get view(): Pick<MarkdownEditorAdapter["view"], "requestMeasure"> {
    return this.#adapter?.view ?? unloadedView;
  }

  get classList(): DOMTokenList { return this.#adapter?.classList ?? this.#source.classList; }
  get value(): string { return this.#adapter?.value ?? this.#value; }
  set value(text: string) {
    this.#value = text;
    if (this.#adapter) this.#adapter.value = text;
    else this.#source.textContent = text;
  }
  get length(): number { return this.#adapter?.length ?? this.#value.length; }
  get selectionStart(): number { return this.#adapter?.selectionStart ?? this.#selectionStart; }
  set selectionStart(value: number) {
    if (this.#adapter) this.#adapter.selectionStart = value;
    else this.#selectionStart = Math.max(0, Math.min(value, this.#value.length));
  }
  get selectionEnd(): number { return this.#adapter?.selectionEnd ?? this.#selectionEnd; }
  set selectionEnd(value: number) {
    if (this.#adapter) this.#adapter.selectionEnd = value;
    else this.#selectionEnd = Math.max(0, Math.min(value, this.#value.length));
  }
  get scrollTop(): number { return this.#adapter?.scrollTop ?? this.#scrollTop; }
  set scrollTop(value: number) {
    this.#scrollTop = value;
    if (this.#adapter) this.#adapter.scrollTop = value;
  }
  get scrollLeft(): number { return this.#adapter?.scrollLeft ?? 0; }
  set scrollLeft(value: number) { if (this.#adapter) this.#adapter.scrollLeft = value; }
  get scrollHeight(): number { return this.#adapter?.scrollHeight ?? this.#source.scrollHeight; }
  get clientHeight(): number { return this.#adapter?.clientHeight ?? this.#source.clientHeight; }

  async ready(): Promise<MarkdownEditorAdapter> {
    if (this.#adapter) return this.#adapter;
    if (!this.#loading) {
      this.#loading = import("./markdown-editor").then(({ createMarkdownEditor }) => {
        const adapter = createMarkdownEditor(this.#source, this.#options);
        this.#adapter = adapter;
        for (const queued of this.#listeners) adapter.addEventListener(queued.type, queued.listener, queued.options);
        if (this.#value) adapter.value = this.#value;
        adapter.setSelectionRange(this.#selectionStart, this.#selectionEnd);
        adapter.scrollTop = this.#scrollTop;
        return adapter;
      });
    }
    return this.#loading;
  }

  async openDocument(key: string, text: string, fallbackCursor = 0): Promise<void> {
    this.#value = text;
    this.#selectionStart = fallbackCursor;
    this.#selectionEnd = fallbackCursor;
    this.#scrollTop = 0;
    if (!key && !this.#adapter) {
      this.#source.textContent = text;
      return;
    }
    const adapter = await this.ready();
    adapter.openDocument(key, text, fallbackCursor);
  }

  applyUserEdit(text: string, selectionStart: number, selectionEnd: number): void {
    if (this.#adapter) {
      this.#adapter.applyUserEdit(text, selectionStart, selectionEnd);
      return;
    }
    this.#value = text;
    this.#source.textContent = text;
    this.#selectionStart = Math.max(0, Math.min(selectionStart, text.length));
    this.#selectionEnd = Math.max(0, Math.min(selectionEnd, text.length));
  }

  rememberDocumentState(): void { this.#adapter?.rememberDocumentState(); }
  setSelectionRange(anchor: number, head: number): void {
    if (this.#adapter) this.#adapter.setSelectionRange(anchor, head);
    else {
      this.#selectionStart = Math.max(0, Math.min(anchor, this.#value.length));
      this.#selectionEnd = Math.max(0, Math.min(head, this.#value.length));
    }
  }
  focus(): void {
    if (this.#adapter) this.#adapter.focus();
    else void this.ready().then(adapter => adapter.focus());
  }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean): void {
    this.#listeners.push({ type, listener, options });
    this.#adapter?.addEventListener(type, listener, options);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const index = this.#listeners.findIndex(queued => queued.type === type && queued.listener === listener);
    if (index >= 0) this.#listeners.splice(index, 1);
    this.#adapter?.removeEventListener(type, listener);
  }
  setAttribute(name: string, value: string): void {
    if (name === "wrap") this.setWordWrap(value !== "off");
    else if (this.#adapter) this.#adapter.setAttribute(name, value);
    else this.#source.setAttribute(name, value);
  }
  setWordWrap(enabled: boolean): void {
    this.#options.wordWrap = enabled;
    this.#adapter?.setWordWrap(enabled);
  }
  setLineNumbers(enabled: boolean): void {
    this.#options.lineNumbers = enabled;
    this.#adapter?.setLineNumbers(enabled);
  }
  destroy(): void { this.#adapter?.destroy(); }
}

export function createLazyMarkdownEditor(source: HTMLElement, options?: MarkdownEditorOptions): LazyMarkdownEditorAdapter {
  return new LazyMarkdownEditorAdapter(source, options);
}

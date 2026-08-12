import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentLess } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap, type CompletionContext } from "@codemirror/autocomplete";

export interface MarkdownCompletion { label: string; type?: "text" | "keyword" }
export interface MarkdownEditorOptions {
  lineNumbers?: boolean;
  wordWrap?: boolean;
  getCompletions?: (prefix: "#" | "[[", query: string) => MarkdownCompletion[];
  largeFileThreshold?: number;
}

export function useMarkdownExtensions(length: number, threshold = 1_000_000): boolean {
  return length <= threshold;
}

export function clampEditorSelection(anchor: number, head: number, length: number): [number, number] {
  return [Math.max(0, Math.min(anchor, length)), Math.max(0, Math.min(head, length))];
}

interface StoredDocumentState { anchor: number; head: number; scrollTop: number }

const STATE_KEY = "recallstack-editor-document-state-v1";

function loadStates(): Record<string, StoredDocumentState> {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || "{}"); } catch { return {}; }
}

function completionSource(getCompletions?: MarkdownEditorOptions["getCompletions"]) {
  return (context: CompletionContext) => {
    if (!getCompletions) return null;
    const before = context.state.sliceDoc(Math.max(0, context.pos - 160), context.pos);
    const match = before.match(/(\[\[|#)([^\s#[\]]*)$/u);
    if (!match) return null;
    const prefix = match[1] as "#" | "[[";
    return {
      from: context.pos - match[2].length,
      options: getCompletions(prefix, match[2]),
      validFor: /^[^\s#[\]]*$/u,
    };
  };
}

export class MarkdownEditorAdapter {
  readonly view: EditorView;
  readonly classList: DOMTokenList;
  readonly #wrap = new Compartment();
  readonly #gutters = new Compartment();
  readonly #language = new Compartment();
  readonly #states = loadStates();
  readonly #largeFileThreshold: number;
  #documentKey: string | null = null;
  #wordWrap: boolean;
  #lineNumbers: boolean;
  #programmatic = false;

  constructor(source: HTMLElement, options: MarkdownEditorOptions = {}) {
    const host = document.createElement("div");
    host.id = source.id;
    host.className = `${source.className} cm-markdown-editor`;
    source.replaceWith(host);
    this.classList = host.classList;
    this.#wordWrap = options.wordWrap ?? true;
    this.#lineNumbers = options.lineNumbers ?? false;
    this.#largeFileThreshold = options.largeFileThreshold ?? 1_000_000;
    const notify = EditorView.updateListener.of(update => {
      if (update.docChanged && !this.#programmatic) this.view.dom.dispatchEvent(new Event("input"));
    });
    this.view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source.textContent || "",
        extensions: [
          highlightSpecialChars(), history(), drawSelection(), dropCursor(), rectangularSelection(), crosshairCursor(),
          highlightActiveLine(), bracketMatching(), foldGutter(), highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([{ key: "Shift-Tab", run: indentLess }, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...defaultKeymap.filter(binding => binding.key !== "Enter" && binding.key !== "Tab" && binding.key !== "Shift-Tab")]),
          autocompletion({ override: [completionSource(options.getCompletions)] }),
          this.#gutters.of(this.#lineNumbers ? lineNumbers() : []),
          this.#wrap.of(this.#wordWrap ? EditorView.lineWrapping : []),
          this.#language.of(useMarkdownExtensions(source.textContent?.length || 0, this.#largeFileThreshold) ? markdown() : []),
          notify,
          EditorView.contentAttributes.of({ "aria-label": source.dataset.placeholder || "Markdown editor", spellcheck: "false" }),
        ],
      }),
    });
  }

  get value(): string { return this.view.state.doc.toString(); }
  set value(text: string) { this.setText(text, false); }
  get length(): number { return this.view.state.doc.length; }
  get selectionStart(): number { return this.view.state.selection.main.from; }
  set selectionStart(value: number) { this.setSelectionRange(value, Math.max(value, this.selectionEnd)); }
  get selectionEnd(): number { return this.view.state.selection.main.to; }
  set selectionEnd(value: number) { this.setSelectionRange(Math.min(this.selectionStart, value), value); }
  get scrollTop(): number { return this.view.scrollDOM.scrollTop; }
  set scrollTop(value: number) { this.view.scrollDOM.scrollTop = value; }
  get scrollLeft(): number { return this.view.scrollDOM.scrollLeft; }
  set scrollLeft(value: number) { this.view.scrollDOM.scrollLeft = value; }
  get scrollHeight(): number { return this.view.scrollDOM.scrollHeight; }
  get clientHeight(): number { return this.view.scrollDOM.clientHeight; }

  setText(text: string, preserveHistory = false): void {
    this.#programmatic = true;
    try {
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: text },
        selection: EditorSelection.cursor(Math.min(this.selectionStart, text.length)),
        annotations: Transaction.addToHistory.of(preserveHistory),
        effects: this.#language.reconfigure(useMarkdownExtensions(text.length, this.#largeFileThreshold) ? markdown() : []),
      });
    } finally { this.#programmatic = false; }
  }

  openDocument(key: string, text: string, fallbackCursor = 0): void {
    this.rememberDocumentState();
    this.#documentKey = key;
    this.setText(text, false);
    const stored = this.#states[key];
    this.setSelectionRange(stored?.anchor ?? fallbackCursor, stored?.head ?? fallbackCursor);
    requestAnimationFrame(() => { this.scrollTop = stored?.scrollTop ?? 0; });
  }

  rememberDocumentState(): void {
    if (!this.#documentKey) return;
    const selection = this.view.state.selection.main;
    this.#states[this.#documentKey] = { anchor: selection.anchor, head: selection.head, scrollTop: this.scrollTop };
    const keys = Object.keys(this.#states);
    for (const key of keys.slice(0, Math.max(0, keys.length - 100))) delete this.#states[key];
    try { localStorage.setItem(STATE_KEY, JSON.stringify(this.#states)); } catch { /* storage unavailable */ }
  }

  setSelectionRange(anchor: number, head: number): void {
    const length = this.view.state.doc.length;
    const [safeAnchor, safeHead] = clampEditorSelection(anchor, head, length);
    this.view.dispatch({ selection: EditorSelection.single(safeAnchor, safeHead) });
  }
  focus(): void { this.view.focus(); }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean): void {
    const target = type === "scroll" ? this.view.scrollDOM : this.view.dom;
    target.addEventListener(type, listener, type === "scroll" ? options : { capture: true });
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const target = type === "scroll" ? this.view.scrollDOM : this.view.dom;
    target.removeEventListener(type, listener, type === "scroll" ? undefined : { capture: true });
  }
  setAttribute(name: string, value: string): void {
    if (name === "wrap") this.setWordWrap(value !== "off"); else this.view.dom.setAttribute(name, value);
  }
  setWordWrap(enabled: boolean): void {
    this.#wordWrap = enabled;
    this.view.dispatch({ effects: this.#wrap.reconfigure(enabled ? EditorView.lineWrapping : []) });
  }
  setLineNumbers(enabled: boolean): void {
    this.#lineNumbers = enabled;
    this.view.dispatch({ effects: this.#gutters.reconfigure(enabled ? lineNumbers() : []) });
  }
  destroy(): void { this.rememberDocumentState(); this.view.destroy(); }
}

export function createMarkdownEditor(source: HTMLElement, options?: MarkdownEditorOptions): MarkdownEditorAdapter {
  return new MarkdownEditorAdapter(source, options);
}

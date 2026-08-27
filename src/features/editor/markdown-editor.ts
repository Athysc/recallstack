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
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap, type CompletionContext } from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";

// CodeMirror's built-in defaultHighlightStyle ships fixed hex colors per
// syntax tag (e.g. tags.meta -> "#404740", a near-black green meant for a
// light background) with zero awareness of this app's theme system. That's
// what made markdown syntax marks (#, *, _, `, [ ] ( )) hard to see in dark
// themes: @lezer/markdown tags all of those literal mark characters as
// tags.processingInstruction (a specialization of tags.meta — see
// "HeaderMark HardBreak QuoteMark ListMark LinkMark EmphasisMark CodeMark" in
// @lezer/markdown's styleTags call), which defaultHighlightStyle only colors
// via that inherited tags.meta rule.
//
// This app is theme-aware everywhere else via CSS custom properties set on
// :root per theme (see applyThemeVariables() in src/features/themes/runtime.ts
// and src/ui/styles/tokens.css/editor.css) — 31 themes, mixed light/dark,
// each with different --base/--overlay*/--subtext* values, so no single
// hardcoded hex can look right in all of them. Building the HighlightStyle
// with var(--...) strings (rather than colors resolved once at definition
// time) keeps it correctly theme-reactive: applyThemeVariables() sets these
// custom properties directly on document.documentElement, so the browser
// re-resolves var(--overlay1) etc. live on every theme switch with no need
// to rebuild this style or the editor.
//
// --overlay1 was chosen for the mark characters over --overlay0 (too close
// to --base/--mantle in several dark themes, e.g. flatly-fog/cosmo-fog sit
// under 2.5:1) — --overlay1 stays >=3.5:1 against --base in every shipped
// dark theme except the deliberately low-contrast "quartz" (whose own
// --text tops out at 4.6:1 against its unusually light "dark" base, so no
// muted token could clear much more there either), while remaining
// comfortably >=3.6:1 in every light theme. It's also already this app's
// established "muted helper text" token elsewhere (e.g. .settings-help-text).
const markdownHighlightStyle = HighlightStyle.define([
  // The literal markup characters themselves — the reported bug.
  { tag: [tags.processingInstruction, tags.contentSeparator], color: "var(--overlay1)" },
  // Content that used to get a hardcoded color from defaultHighlightStyle
  // (comment/escape/url/label/string) is remapped to theme tokens instead of
  // being dropped, so nothing regresses to unstyled plain text.
  { tag: tags.comment, color: "var(--overlay1)", fontStyle: "italic" },
  { tag: tags.escape, color: "var(--subtext1)" },
  { tag: [tags.url, tags.labelName], color: "var(--blue)" },
  { tag: tags.string, color: "var(--green)" },
  { tag: tags.invalid, color: "var(--red)" },
  // Non-color decorations are unchanged from defaultHighlightStyle — these
  // tags had no hardcoded color to begin with, so they already inherited
  // --text from .cm-editor and don't need remapping.
  { tag: tags.link, textDecoration: "underline" },
  { tag: tags.heading, textDecoration: "underline", fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);

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
          highlightSpecialChars(), history({ minDepth: 50 }), drawSelection(), dropCursor(), rectangularSelection(), crosshairCursor(),
          highlightActiveLine(), bracketMatching(), foldGutter(), highlightSelectionMatches(),
          syntaxHighlighting(markdownHighlightStyle, { fallback: true }),
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

  /**
   * Apply a full-document replacement as a single, undoable user edit — for the
   * structural editor commands (list continuation, indent, delete-line,
   * blockquote, insert). Unlike `setText`/`value`, this stays in CodeMirror's
   * undo history and still fires the `input` event so preview/draft/dirty
   * tracking update.
   */
  applyUserEdit(text: string, selectionStart: number, selectionEnd: number): void {
    const length = text.length;
    const [anchor, head] = clampEditorSelection(selectionStart, selectionEnd, length);
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: EditorSelection.range(anchor, head),
      annotations: Transaction.addToHistory.of(true),
      effects: this.#language.reconfigure(useMarkdownExtensions(length, this.#largeFileThreshold) ? markdown() : []),
      scrollIntoView: true,
    });
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

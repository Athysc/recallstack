import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";

export class MarkdownEditor {
  private view: EditorView;
  private onChange: (value: string) => void;

  constructor(parent: HTMLElement, onChange: (value: string) => void) {
    this.onChange = onChange;
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "",
        extensions: [
          history(), markdown(), oneDark,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => { if (update.docChanged) this.onChange(update.state.doc.toString()); }),
        ],
      }),
    });
  }

  setValue(value: string): void {
    const current = this.value();
    if (current !== value) this.view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }

  value(): string { return this.view.state.doc.toString(); }
  focus(): void { this.view.focus(); }
}

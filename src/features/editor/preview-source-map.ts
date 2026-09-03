import { marked } from "marked";

export interface SourceBlock {
  /** 1-based line (into the pre-processed markdown) where this block starts. */
  startLine: number;
  /** 1-based line where the block ends (inclusive-ish; startLine + newline count in raw). */
  endLine: number;
  type: string;
}

const HTML_COMMENT_ONLY = /^(?:\s*<!--[\s\S]*?-->\s*)+$/;

function countNewlines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Maps the top-level markdown blocks of `preprocessed` to their start line, in
 * document order. `preprocessed` must be the line-count-preserving output of the
 * runtime's `preprocessMarkdown` (NOT `preserveExtraBlankLines`, which inserts a
 * spacer line), so `startLine` also indexes the editor's live `mdEditor.value`.
 *
 * The returned array lines up 1:1 with the preview's top-level block elements in
 * document order, once `div.md-extra-blank-lines` spacers and the appended
 * `section.preview-backlinks` are skipped on the DOM side. `space` tokens and
 * comment-only `html` tokens produce no block element, so they advance the line
 * counter but are not pushed. (A standalone `[id]: url` reference definition
 * produces neither a token nor a `.raw` slice in marked, so blocks after one are
 * shifted up by its line span — an accepted, rare inaccuracy.)
 */
export function sourceBlocksFromPreprocessed(preprocessed: string): SourceBlock[] {
  const out: SourceBlock[] = [];
  let line = 1;
  for (const token of marked.lexer(preprocessed)) {
    const raw = typeof token.raw === "string" ? token.raw : "";
    const nl = countNewlines(raw);
    const emitsBlock =
      token.type !== "space" &&
      !(token.type === "html" && HTML_COMMENT_ONLY.test(raw));
    if (emitsBlock) out.push({ startLine: line, endLine: line + nl, type: token.type });
    line += nl;
  }
  return out;
}

/** Count of `\n` in `text` strictly before character index `offset`. */
export function newlinesBefore(text: string, offset: number): number {
  return countNewlines(text.slice(0, Math.max(0, Math.min(offset, text.length))));
}

/**
 * Source line for a caret inside a rendered code block. `baseLine` is the block's
 * start line (the opening fence line for a fenced block, or the first content
 * line for an indented block); `baseSourceLine` is that source line's text;
 * `nlBeforeCaret` is the newline count within the `<code>` text before the caret.
 */
export function codeBlockLine(baseLine: number, baseSourceLine: string, nlBeforeCaret: number): number {
  const fenced = /^\s*(?:`{3,}|~{3,})/.test(baseSourceLine);
  return baseLine + nlBeforeCaret + (fenced ? 1 : 0);
}

export function clampLine(line: number, totalLines: number): number {
  const n = Math.floor(line) || 1;
  return Math.max(1, Math.min(n, Math.max(1, totalLines)));
}

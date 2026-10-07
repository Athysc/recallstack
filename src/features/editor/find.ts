/**
 * Pure logic for the in-document find box (Ctrl+Shift+F). Kept free of DOM and
 * CodeMirror imports so it can be unit-tested directly.
 *
 * The term is treated as a case-insensitive regular expression. If it is not a
 * valid pattern (e.g. an unbalanced "(" while typing), it silently falls back to
 * a literal search so the box never errors.
 */

export interface FindRange { from: number; to: number }

export const MAX_FIND_MATCHES = 5000;

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the matcher for a term; null for an empty term. */
export function buildFindRegExp(term: string): RegExp | null {
  if (!term) return null;
  try { return new RegExp(term, "gimu"); } catch { /* fall through to literal */ }
  return new RegExp(escapeRegExp(term), "gimu");
}

/** True when `term` is valid as a regular expression (false means literal fallback). */
export function isValidPattern(term: string): boolean {
  try { new RegExp(term, "gimu"); return true; } catch { return false; }
}

/** All non-empty matches of `term` in `text`, in document order (capped). */
export function findMatches(text: string, term: string, limit = MAX_FIND_MATCHES): FindRange[] {
  const re = buildFindRegExp(term);
  if (!re) return [];
  const out: FindRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < limit) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push({ from: m.index, to: m.index + m[0].length });
  }
  return out;
}

/** Step `current` by `delta` (+1 / -1) with wrap-around. Returns -1 for no matches. */
export function stepIndex(current: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/**
 * Index of the match to land on from caret position `pos`: the first match
 * starting at or after `pos` (forward), or the last match starting before `pos`
 * (backward), wrapping around. Returns -1 when there are no matches.
 */
export function indexFromPosition(matches: readonly FindRange[], pos: number, delta: 1 | -1): number {
  if (matches.length === 0) return -1;
  if (delta === 1) {
    const i = matches.findIndex(m => m.from >= pos);
    return i === -1 ? 0 : i;
  }
  for (let i = matches.length - 1; i >= 0; i--) if (matches[i].from < pos) return i;
  return matches.length - 1;
}

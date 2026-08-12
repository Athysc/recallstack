import assert from "node:assert/strict";
import test from "node:test";
import { marked } from "marked";

import { preserveExtraBlankLines } from "../../src/services/markdown-spacing.ts";

test("single Markdown separator remains unchanged", () => {
  assert.equal(preserveExtraBlankLines("First\n\nSecond"), "First\n\nSecond");
});

test("additional blank lines become preview spacers", () => {
  const result = preserveExtraBlankLines("First\n\n\n\nSecond");
  assert.match(result, /md-extra-blank-lines/);
  assert.equal((result.match(/<span><\/span>/g) || []).length, 2);
  const rendered = marked.parse(result);
  assert.match(rendered, /<div class="md-extra-blank-lines"/);
  assert.equal((rendered.match(/<span><\/span>/g) || []).length, 2);
});

test("blank lines inside fenced code remain untouched", () => {
  const markdown = "```txt\nfirst\n\n\nsecond\n```";
  assert.equal(preserveExtraBlankLines(markdown), markdown);
});

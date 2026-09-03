import assert from "node:assert/strict";
import test from "node:test";

import {
  clampLine,
  codeBlockLine,
  newlinesBefore,
  sourceBlocksFromPreprocessed,
} from "../../src/features/editor/preview-source-map.ts";

// `preprocessMarkdown` in the runtime is 1:1 line-count preserving, so these
// fixtures stand in for its output. `marked.use({breaks:true})` in the app does
// not affect block tokenization, so tests need not replicate it.

const FIXTURE = [
  "# Title", //             1
  "", //                    2
  "First paragraph.", //    3
  "", //                    4
  "- a", //                 5
  "- b", //                 6
  "", //                    7
  "", //                    8  extra blank
  "```js", //               9
  "const x = 1;", //        10
  "", //                    11
  "foo();", //              12
  "```", //                 13
  "", //                    14
  "> quote 1", //           15
  "> quote 2", //           16
  "", //                    17
  "| a | b |", //           18
  "|---|---|", //           19
  "| 1 | 2 |", //           20
  "", //                    21
  "<!-- a comment -->", //  22
  "", //                    23
  "after comment", //       24
].join("\n");

test("sourceBlocksFromPreprocessed maps each top-level block to its start line", () => {
  const blocks = sourceBlocksFromPreprocessed(FIXTURE);
  assert.deepEqual(
    blocks.map(b => [b.type, b.startLine]),
    [
      ["heading", 1],
      ["paragraph", 3],
      ["list", 5],
      ["code", 9],
      ["blockquote", 15],
      ["table", 18],
      ["paragraph", 24],
    ],
  );
});

test("blank runs and comment-only html emit no block but still advance the line count", () => {
  const blocks = sourceBlocksFromPreprocessed(FIXTURE);
  assert.ok(!blocks.some(b => b.type === "space"));
  // The paragraph after 2 extra blank lines + the comment line still lands on 24.
  assert.equal(blocks.at(-1)!.startLine, 24);
});

test("fenced code block spans from its opening fence to its closing fence", () => {
  const code = sourceBlocksFromPreprocessed(FIXTURE).find(b => b.type === "code")!;
  assert.equal(code.startLine, 9);
  assert.equal(code.endLine, 13);
});

test("codeBlockLine skips the opening fence for fenced blocks only", () => {
  assert.equal(codeBlockLine(9, "```js", 3), 13);       // clicked 3 lines into the code
  assert.equal(codeBlockLine(9, "~~~", 0), 10);         // first content line
  assert.equal(codeBlockLine(4, "    indented", 1), 5); // indented block: no fence to skip
});

test("newlinesBefore counts newlines strictly before the offset, clamped", () => {
  assert.equal(newlinesBefore("a\nb\nc", 0), 0);
  assert.equal(newlinesBefore("a\nb\nc", 2), 1);
  assert.equal(newlinesBefore("a\nb\nc", 100), 2);
  assert.equal(newlinesBefore("a\nb\nc", -5), 0);
});

test("clampLine keeps the result within 1..totalLines", () => {
  assert.equal(clampLine(0, 10), 1);
  assert.equal(clampLine(5.9, 10), 5);
  assert.equal(clampLine(999, 10), 10);
  assert.equal(clampLine(3, 0), 1);
});

test("known drift: a standalone reference definition shifts later blocks up", () => {
  // Documented limitation — marked emits no token and no `.raw` for a lone
  // `[id]: url`, so the paragraph after it maps two lines early. If this is ever
  // fixed, update the expected value deliberately.
  const src = ["para one", "", "[ref]: https://example.com", "", "para two"].join("\n");
  const blocks = sourceBlocksFromPreprocessed(src);
  assert.equal(blocks[0]!.startLine, 1);
  assert.equal(blocks.at(-1)!.startLine, 3); // true line is 5
});

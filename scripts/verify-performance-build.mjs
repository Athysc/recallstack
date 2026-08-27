import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const dist = resolve(import.meta.dirname, "../dist");
const html = readFileSync(resolve(dist, "index.html"), "utf8");
const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/);
if (!entryMatch) throw new Error("Production build has no module entry script");

const editorChunk = /(?:markdown-editor|editor-(?:core|tools|parser|markdown))-[^/]+\.js$/;
const preloadedEditor = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)]
  .map(match => match[1])
  .find(href => editorChunk.test(href));
if (preloadedEditor) throw new Error(`Editor chunk must remain lazy, but index.html preloads ${preloadedEditor}`);

function staticImports(source) {
  return [...source.matchAll(/(?:^|[;\n])\s*import(?:[^"'(]*?from\s*)?["']([^"']+)["']/g)].map(match => match[1]);
}

const entry = resolve(dist, entryMatch[1].replace(/^\//, ""));
const visited = new Set();
function visit(file) {
  const absolute = resolve(file);
  if (visited.has(absolute)) return;
  visited.add(absolute);
  const source = readFileSync(absolute, "utf8");
  for (const specifier of staticImports(source)) {
    if (!specifier.startsWith(".")) continue;
    const dependency = resolve(dirname(absolute), specifier);
    if (editorChunk.test(basename(dependency))) {
      throw new Error(`Initial dependency graph statically imports lazy editor chunk ${basename(dependency)}`);
    }
    visit(dependency);
  }
}
visit(entry);
const entrySource = readFileSync(entry, "utf8");
for (const match of entrySource.matchAll(/import\(["'](\.\/(?:desktop-bridge|recallstack-runtime)-[^"']+\.js)["']\)/g)) {
  visit(resolve(dirname(entry), match[1]));
}

const initialBytes = [...visited].reduce((total, file) => total + statSync(file).size, 0);
// Raised from 340_000 on 2026-08-26 (idle/resume watcher work) and from 360_000
// on 2026-08-27: the grouped listing modals (Notes / Tasks / Working Tasks with
// sections, priority colors, per-listing sort, and archive/restore) plus the
// central keymap put the measured initial graph near 362 KB raw (~77 KB gzip,
// unchanged). 372_000 keeps a ~10 KB regression margin.
const budgetBytes = 372_000;
if (initialBytes > budgetBytes) {
  throw new Error(`Initial JavaScript is ${initialBytes} bytes; budget is ${budgetBytes} bytes`);
}

const emittedEditorChunks = readdirSync(resolve(dist, "assets")).filter(file => editorChunk.test(file));
if (!emittedEditorChunks.length) throw new Error("Expected CodeMirror to be emitted as lazy editor chunks");
console.log(`PERF frontend_initial_js bytes=${initialBytes} budget=${budgetBytes} lazy_editor_chunks=${emittedEditorChunks.length}`);

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");
const legacy = await read("recallstack.html");
const entry = await read("index.html");

const legacyMarkup = legacy.match(/<body>\n([\s\S]*?)\n<script>/)?.[1];
const entryMarkup = entry.match(/<body>\n([\s\S]*?)\n<script type="module"/)?.[1];
assert.ok(legacyMarkup, "could not locate the reference body markup");
assert.ok(entryMarkup, "could not locate the production body markup");
assert.equal(entryMarkup, legacyMarkup, "production DOM no longer matches the original interface");

const legacyCss = legacy.match(/<style>\n([\s\S]*?)\n<\/style>/)?.[1];
assert.ok(legacyCss, "could not locate the reference stylesheet");
const styleFiles = [
  "tokens.css",
  "shell.css",
  "files.css",
  "editor.css",
  "assets.css",
  "modals.css",
  "search.css",
  "calendar.css",
  "shell-extras.css",
  "editor-extras.css",
  "utilities.css",
];
const modularCss = (await Promise.all(styleFiles.map((file) => read(`src/ui/styles/${file}`))))
  .join("");
assert.equal(modularCss, `${legacyCss}\n`, "modular CSS no longer matches the original interface");

assert.doesNotMatch(entry, /recallstack\.html|desktop-shim\.js/, "production entry references a legacy asset");
console.log(`Frontend parity verified: ${entryMarkup.length} markup bytes and ${legacyCss.length} CSS bytes.`);

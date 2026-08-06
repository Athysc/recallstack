import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "public", "lib");
await mkdir(output, { recursive: true });

const files = [
  ["node_modules/marked/lib/marked.umd.js", "marked.min.js"],
  ["node_modules/@highlightjs/cdn-assets/highlight.min.js", "highlight.min.js"],
  ["node_modules/@highlightjs/cdn-assets/highlight.min.js", "highlight.full.min.js"],
  ["node_modules/mermaid/dist/mermaid.min.js", "mermaid.min.js"],
  ["node_modules/sql.js/dist/sql-wasm.js", "sql-wasm.js"],
  ["node_modules/sql.js/dist/sql-wasm.wasm", "sql-wasm.wasm"],
];

for (const [source, destination] of files) {
  await copyFile(resolve(root, source), resolve(output, destination));
}
await copyFile(resolve(root, "desktop-shim.js"), resolve(root, "public", "desktop-shim.js"));

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
];

for (const [source, destination] of files) {
  await copyFile(resolve(root, source), resolve(output, destination));
}
await copyFile(resolve(root, "themes.json"), resolve(root, "public", "theme.json"));
await copyFile(resolve(root, "external-themes.sample.json"), resolve(root, "public", "external-themes.sample.json"));
await copyFile(resolve(root, "portable", "readme.md"), resolve(root, "public", "readme.md"));
await copyFile(resolve(root, "portable", "changes.md"), resolve(root, "public", "changes.md"));

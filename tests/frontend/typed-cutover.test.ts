import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

async function typeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typeScriptFiles(path);
    return extname(entry.name) === ".ts" ? [path] : [];
  }));
  return nested.flat();
}

test("production TypeScript has no file or line checking suppressions", async () => {
  const files = await typeScriptFiles(resolve(root, "src"));
  assert.ok(files.some(path => path.endsWith("recallstack-runtime.ts")));

  for (const path of files) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /@ts-(?:nocheck|ignore|expect-error)\b/, path);
  }
});

test("the compiler keeps strict checking enabled for the complete frontend", async () => {
  const config = JSON.parse(await readFile(resolve(root, "tsconfig.json"), "utf8"));
  assert.equal(config.compilerOptions?.strict, true);
  assert.deepEqual(config.include, ["src"]);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseThemeCatalog } from "../../src/features/themes/catalog.ts";

test("the shipped external theme catalog is valid", async () => {
  const source = await readFile(new URL("../../themes.json", import.meta.url), "utf8");
  const catalog = parseThemeCatalog(source);

  assert.equal(catalog.version, 1);
  assert.ok(catalog.themes.length > 1);
  assert.ok(catalog.themes.some((theme) => theme.id === catalog.defaultTheme));
  assert.ok(catalog.themes.some((theme) => theme.mode === "light"));
  assert.ok(catalog.themes.some((theme) => theme.mode === "dark"));
});

test("theme validation rejects duplicate ids and missing colors", async () => {
  const source = await readFile(new URL("../../themes.json", import.meta.url), "utf8");
  const duplicate = JSON.parse(source);
  duplicate.themes[1].id = duplicate.themes[0].id;
  assert.throws(() => parseThemeCatalog(JSON.stringify(duplicate)), /duplicated/);

  const missingColor = JSON.parse(source);
  delete missingColor.themes[0].variables["--base"];
  assert.throws(() => parseThemeCatalog(JSON.stringify(missingColor)), /missing required variable --base/);
});

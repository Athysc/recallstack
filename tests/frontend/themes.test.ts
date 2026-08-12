import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseThemeCatalog } from "../../src/features/themes/catalog.ts";
import { colorContrastRatio, darkenHex, hexToRgba, mixHex, readableThemeAccent, themeRuntimeState } from "../../src/features/themes/runtime.ts";

test("the shipped external theme catalog is valid", async () => {
  const source = await readFile(new URL("../../themes.json", import.meta.url), "utf8");
  const catalog = parseThemeCatalog(source);

  assert.equal(catalog.version, 1);
  assert.ok(catalog.themes.length > 1);
  assert.ok(catalog.themes.some((theme) => theme.id === catalog.defaultTheme));
  assert.ok(catalog.themes.some((theme) => theme.mode === "light"));
  assert.ok(catalog.themes.some((theme) => theme.mode === "dark"));
});

test("active-tab accents retain readable contrast in every shipped theme", async () => {
  const source = await readFile(new URL("../../themes.json", import.meta.url), "utf8");
  const catalog = parseThemeCatalog(source);
  for (const theme of catalog.themes) {
    const background = mixHex(theme.variables["--mauve"], theme.variables["--mantle"], 0.14);
    const accent = readableThemeAccent(theme.variables["--mauve"], background);
    assert.ok(colorContrastRatio(accent, background) >= 4.5, theme.id);
  }
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

test("theme runtime derives indexed state and color tints", async () => {
  const source = await readFile(new URL("../../themes.json", import.meta.url), "utf8");
  const catalog = parseThemeCatalog(source);
  const state = themeRuntimeState(catalog);
  assert.equal(state.defaultTheme, catalog.defaultTheme);
  assert.equal(state.details[catalog.defaultTheme].id, catalog.defaultTheme);
  assert.equal(state.variables[catalog.defaultTheme]["--blue"], catalog.themes.find(theme => theme.id === catalog.defaultTheme)?.variables["--blue"]);
  assert.equal(hexToRgba("#89b4fa", 0.2), "rgba(137,180,250,0.2)");
  assert.equal(darkenHex("#ffffff"), "rgb(140,140,140)");
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseThemeCatalog, parseExternalThemeCatalog } from "../../src/features/themes/catalog.ts";
import { colorContrastRatio, darkenHex, hexToRgba, mixHex, readableThemeAccent, themeRuntimeState } from "../../src/features/themes/runtime.ts";

test("the built-in theme catalog is valid", async () => {
  const source = await readFile(new URL("../../builtin-themes.json", import.meta.url), "utf8");
  const catalog = parseThemeCatalog(source);

  assert.equal(catalog.version, 1);
  assert.ok(catalog.themes.length >= 20, `expected the full built-in set, got ${catalog.themes.length}`);
  assert.ok(catalog.themes.some((theme) => theme.id === catalog.defaultTheme));
  assert.ok(catalog.themes.some((theme) => theme.mode === "light"));
  assert.ok(catalog.themes.some((theme) => theme.mode === "dark"));
});

test("the bundled theme.json sample is a valid catalog to copy from", async () => {
  const source = await readFile(new URL("../../themes.json", import.meta.url), "utf8");
  const catalog = parseThemeCatalog(source);

  assert.equal(catalog.version, 1);
  assert.ok(catalog.themes.length >= 1 && catalog.themes.length <= 4, "the sample stays small");
  assert.ok(catalog.themes.some((theme) => theme.id === catalog.defaultTheme));
  assert.ok(catalog.themes.some((theme) => theme.mode === "light"));
  assert.ok(catalog.themes.some((theme) => theme.mode === "dark"));
});

test("active-tab accents retain readable contrast in every built-in theme", async () => {
  const source = await readFile(new URL("../../builtin-themes.json", import.meta.url), "utf8");
  const catalog = parseThemeCatalog(source);
  for (const theme of catalog.themes) {
    const background = mixHex(theme.variables["--mauve"], theme.variables["--mantle"], 0.14);
    const accent = readableThemeAccent(theme.variables["--mauve"], background);
    assert.ok(colorContrastRatio(accent, background) >= 4.5, theme.id);
  }
});

test("no built-in theme reuses one colour for two palette roles", async () => {
  const source = await readFile(new URL("../../builtin-themes.json", import.meta.url), "utf8");
  const catalog = parseThemeCatalog(source);
  const roles = [
    "--base", "--mantle", "--crust", "--surface0", "--surface1", "--surface2",
    "--overlay0", "--overlay1", "--subtext0", "--subtext1", "--text",
    "--lavender", "--blue", "--sapphire", "--green", "--yellow", "--peach",
    "--red", "--mauve", "--pink",
  ];
  for (const theme of catalog.themes) {
    const used = roles.map((role) => theme.variables[role].toLowerCase());
    assert.equal(new Set(used).size, roles.length, `${theme.id} repeats a colour across roles`);
  }
});

test("theme validation rejects duplicate ids and missing colors", async () => {
  const source = await readFile(new URL("../../builtin-themes.json", import.meta.url), "utf8");
  const duplicate = JSON.parse(source);
  duplicate.themes[1].id = duplicate.themes[0].id;
  assert.throws(() => parseThemeCatalog(JSON.stringify(duplicate)), /duplicated/);

  const missingColor = JSON.parse(source);
  delete missingColor.themes[0].variables["--base"];
  assert.throws(() => parseThemeCatalog(JSON.stringify(missingColor)), /missing required variable --base/);
});

test("theme runtime derives indexed state and color tints", async () => {
  const source = await readFile(new URL("../../builtin-themes.json", import.meta.url), "utf8");
  const catalog = parseThemeCatalog(source);
  const state = themeRuntimeState(catalog);
  assert.equal(state.defaultTheme, catalog.defaultTheme);
  assert.equal(state.details[catalog.defaultTheme].id, catalog.defaultTheme);
  assert.equal(state.variables[catalog.defaultTheme]["--blue"], catalog.themes.find(theme => theme.id === catalog.defaultTheme)?.variables["--blue"]);
  assert.equal(hexToRgba("#89b4fa", 0.2), "rgba(137,180,250,0.2)");
  assert.equal(darkenHex("#ffffff"), "rgb(140,140,140)");
});

test("the bundled external theme sample is a valid extra-theme file", async () => {
  const source = await readFile(new URL("../../external-themes.sample.json", import.meta.url), "utf8");
  const themes = parseExternalThemeCatalog(source);
  assert.equal(themes.length, 2);
  assert.deepEqual(themes.map((theme) => theme.id).sort(), ["lupine", "osaka-jade"]);
  assert.ok(themes.some((theme) => theme.mode === "light"));
  assert.ok(themes.some((theme) => theme.mode === "dark"));
});

test("parseExternalThemeCatalog accepts a bare array and needs no defaultTheme", async () => {
  const source = await readFile(new URL("../../external-themes.sample.json", import.meta.url), "utf8");
  const asArray = JSON.stringify(JSON.parse(source).themes);
  const themes = parseExternalThemeCatalog(asArray);
  assert.equal(themes.length, 2);
});

test("parseExternalThemeCatalog rejects malformed input", () => {
  assert.throws(() => parseExternalThemeCatalog("not json"), /not valid JSON/);
  assert.throws(() => parseExternalThemeCatalog("{}"), /themes array/);
  assert.throws(() => parseExternalThemeCatalog("[]"), /between 1 and 100/);
  assert.throws(
    () => parseExternalThemeCatalog(JSON.stringify([{ id: "x", name: "X", group: "G", mode: "dark", variables: {} }])),
    /missing required variable/,
  );
});

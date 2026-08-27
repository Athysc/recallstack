export interface ThemeDefinition {
  id: string;
  name: string;
  group: string;
  mode: "light" | "dark";
  variables: Record<string, string>;
}

export interface ThemeCatalog {
  version: 1;
  defaultTheme: string;
  themes: ThemeDefinition[];
}

export const REQUIRED_THEME_VARIABLES = [
  "--base", "--mantle", "--crust", "--surface0", "--surface1", "--surface2",
  "--overlay0", "--overlay1", "--subtext0", "--subtext1", "--text",
  "--lavender", "--blue", "--sapphire", "--green", "--yellow", "--peach",
  "--red", "--mauve", "--pink",
] as const;

/** Validate and normalize a single theme entry. `ids` tracks ids already seen. */
export function parseThemeEntry(value: unknown, index: number, ids: Set<string>): ThemeDefinition {
  if (!isRecord(value)) throw new Error(`Theme entry ${index + 1} must be an object`);
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error(`Theme entry ${index + 1} has an invalid id`);
  if (ids.has(id)) throw new Error(`Theme id "${id}" is duplicated`);
  ids.add(id);
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const group = typeof value.group === "string" ? value.group.trim() : "";
  if (!name || name.length > 80) throw new Error(`Theme "${id}" has an invalid name`);
  if (!group || group.length > 80) throw new Error(`Theme "${id}" has an invalid group`);
  if (value.mode !== "light" && value.mode !== "dark") throw new Error(`Theme "${id}" mode must be "light" or "dark"`);
  if (!isRecord(value.variables)) throw new Error(`Theme "${id}" must define a variables object`);
  for (const required of REQUIRED_THEME_VARIABLES) {
    const color = value.variables[required];
    if (typeof color !== "string" || !color.trim()) throw new Error(`Theme "${id}" is missing required variable ${required}`);
    if (!/^#[0-9a-f]{6}$/i.test(color.trim())) throw new Error(`Theme "${id}" variable ${required} must be a six-digit hex color`);
  }
  const variables: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value.variables)) {
    if (!/^--[a-z0-9-]{1,80}$/.test(key)) throw new Error(`Theme "${id}" contains invalid variable "${key}"`);
    if (typeof raw !== "string" || !raw.trim() || raw.length > 500) throw new Error(`Theme "${id}" contains an invalid value for "${key}"`);
    variables[key] = raw.trim();
  }
  return { id, name, group, mode: value.mode, variables };
}

export function parseThemeCatalog(text: string): ThemeCatalog {
  if (typeof text !== "string" || text.length > 1024 * 1024) {
    throw new Error("theme.json must be a UTF-8 JSON file smaller than 1 MB");
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    throw new Error(`theme.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.themes)) {
    throw new Error("theme.json must have version 1 and a themes array");
  }
  if (!input.themes.length || input.themes.length > 200) {
    throw new Error("theme.json must contain between 1 and 200 themes");
  }

  const ids = new Set<string>();
  const themes = input.themes.map((value, index) => parseThemeEntry(value, index, ids));
  const defaultTheme = typeof input.defaultTheme === "string" ? input.defaultTheme : "";
  if (!ids.has(defaultTheme)) throw new Error("defaultTheme must reference a theme id in the themes array");
  return { version: 1, defaultTheme, themes };
}

/**
 * Parse a user-supplied external theme file: a JSON document that is either a
 * bare array of theme entries or `{ themes: [...] }`. `version` is optional (must
 * be `1` when present) and there is no `defaultTheme`. Returns just the themes so
 * the caller can merge them alongside the built-in catalog.
 */
export function parseExternalThemeCatalog(text: string): ThemeDefinition[] {
  if (typeof text !== "string" || text.length > 1024 * 1024) {
    throw new Error("The external theme file must be a UTF-8 JSON file smaller than 1 MB");
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    throw new Error(`The external theme file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  let entries: unknown[];
  if (Array.isArray(input)) {
    entries = input;
  } else if (isRecord(input) && Array.isArray(input.themes)) {
    if (input.version !== undefined && input.version !== 1) {
      throw new Error("The external theme file version must be 1");
    }
    entries = input.themes;
  } else {
    throw new Error("The external theme file must be a themes array or an object with a themes array");
  }
  if (!entries.length || entries.length > 100) {
    throw new Error("The external theme file must contain between 1 and 100 themes");
  }
  const ids = new Set<string>();
  return entries.map((value, index) => parseThemeEntry(value, index, ids));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

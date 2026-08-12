import type { ThemeCatalog, ThemeDefinition } from "./catalog";

export const FALLBACK_THEME_VARIABLES = Object.freeze({
  "--base": "#1e1e2e", "--mantle": "#181825", "--crust": "#11111b",
  "--surface0": "#313244", "--surface1": "#45475a", "--surface2": "#585b70",
  "--overlay0": "#6c7086", "--overlay1": "#7f849c",
  "--subtext0": "#a6adc8", "--subtext1": "#bac2de",
  "--text": "#cdd6f4", "--lavender": "#b4befe", "--blue": "#89b4fa",
  "--sapphire": "#74c7ec", "--green": "#a6e3a1", "--yellow": "#f9e2af",
  "--peach": "#fab387", "--red": "#f38ba8", "--mauve": "#cba6f7", "--pink": "#f5c2e7",
});

export const FALLBACK_THEME_CATALOG: ThemeCatalog = {
  version: 1,
  defaultTheme: "catppuccin",
  themes: [{
    id: "catppuccin",
    name: "Catppuccin",
    group: "Classics",
    mode: "dark",
    variables: FALLBACK_THEME_VARIABLES,
  }],
};

export interface ThemeRuntimeState {
  defaultTheme: string;
  details: Record<string, Omit<ThemeDefinition, "variables">>;
  variables: Record<string, Record<string, string>>;
}

export function themeRuntimeState(catalog: ThemeCatalog): ThemeRuntimeState {
  return {
    defaultTheme: catalog.defaultTheme,
    details: Object.fromEntries(catalog.themes.map(({ variables: _variables, ...theme }) => [theme.id, theme])),
    variables: Object.fromEntries(catalog.themes.map(theme => [theme.id, theme.variables])),
  };
}

export function installThemeOptions(select: HTMLSelectElement, catalog: ThemeCatalog): void {
  select.replaceChildren();
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const theme of catalog.themes) {
    let group = groups.get(theme.group);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = `── ${theme.group} ──`;
      groups.set(theme.group, group);
      select.appendChild(group);
    }
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.name;
    group.appendChild(option);
  }
}

export function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

export function darkenHex(hex: string, multiplier = 0.55): string {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map(start => Math.round(Number.parseInt(value.slice(start, start + 2), 16) * multiplier));
  return `rgb(${channels.join(",")})`;
}

function hexChannels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map(start => Number.parseInt(value.slice(start, start + 2), 16)) as [number, number, number];
}

export function mixHex(foreground: string, background: string, foregroundAmount: number): string {
  const front = hexChannels(foreground);
  const back = hexChannels(background);
  const amount = Math.max(0, Math.min(1, foregroundAmount));
  const mixed = front.map((channel, index) => Math.round(channel * amount + back[index] * (1 - amount)));
  return `#${mixed.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(hex: string): number {
  const channels = hexChannels(hex).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function colorContrastRatio(left: string, right: string): number {
  const [lighter, darker] = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Keep the theme accent hue while moving it only as far as needed for readable text. */
export function readableThemeAccent(accent: string, background: string, minimumRatio = 4.5): string {
  if (colorContrastRatio(accent, background) >= minimumRatio) return accent;
  const target = colorContrastRatio("#000000", background) >= colorContrastRatio("#ffffff", background)
    ? [0, 0, 0]
    : [255, 255, 255];
  const source = hexChannels(accent);
  for (let percent = 5; percent <= 100; percent += 5) {
    const amount = percent / 100;
    const mixed = source.map((channel, index) => Math.round(channel + (target[index] - channel) * amount));
    const candidate = `#${mixed.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
    if (colorContrastRatio(candidate, background) >= minimumRatio) return candidate;
  }
  return target[0] === 0 ? "#000000" : "#ffffff";
}

export function applyThemeVariables(
  root: HTMLElement,
  variables: Record<string, string>,
  mode: "light" | "dark",
  previouslyApplied: Set<string>,
): void {
  for (const variable of previouslyApplied) root.style.removeProperty(variable);
  previouslyApplied.clear();
  for (const [key, value] of Object.entries(variables)) {
    root.style.setProperty(key, value);
    previouslyApplied.add(key);
  }

  const isLight = mode === "light";
  root.style.colorScheme = mode;
  const color = (name: string, fallback: string) => variables[name] || fallback;
  const red = color("--red", "#f38ba8");
  const blue = color("--blue", "#89b4fa");
  const green = color("--green", "#a6e3a1");
  const overlay = color("--overlay1", "#7f849c");
  const yellow = color("--yellow", "#f9e2af");
  const mauve = color("--mauve", "#cba6f7");
  const mantle = color("--mantle", "#181825");
  const activeTabBackground = mixHex(mauve, mantle, 0.14);
  root.style.setProperty("--tab-active-background", activeTabBackground);
  root.style.setProperty("--theme-accent-readable", readableThemeAccent(mauve, activeTabBackground));
  const [backgroundMultiplier, borderMultiplier] = isLight ? [2.2, 2.8] : [1, 1];
  const taskColors = {
    "--task-bg-high": hexToRgba(red, 0.10 * backgroundMultiplier),
    "--task-bd-high": hexToRgba(red, 0.28 * borderMultiplier),
    "--task-bg-normal": hexToRgba(blue, 0.07 * backgroundMultiplier),
    "--task-bd-normal": hexToRgba(blue, 0.18 * borderMultiplier),
    "--task-bg-low": hexToRgba(green, 0.07 * backgroundMultiplier),
    "--task-bd-low": hexToRgba(green, 0.20 * borderMultiplier),
    "--task-bg-blocked": hexToRgba(overlay, 0.12 * backgroundMultiplier),
    "--task-bd-blocked": hexToRgba(overlay, 0.30 * borderMultiplier),
    "--task-bg-onhold": hexToRgba(yellow, 0.08 * backgroundMultiplier),
    "--task-bd-onhold": hexToRgba(yellow, 0.22 * borderMultiplier),
  };
  for (const [key, value] of Object.entries(taskColors)) root.style.setProperty(key, value);

  const dateColors = {
    start: green,
    completed: color("--lavender", "#b4befe"),
    due: red,
    priority: yellow,
  };
  for (const [key, value] of Object.entries(dateColors)) {
    root.style.setProperty(`--dp-${key}-bg`, hexToRgba(value, isLight ? 0.14 : 0.17));
    root.style.setProperty(`--dp-${key}-color`, isLight ? darkenHex(value) : value);
    root.style.setProperty(`--dp-${key}-border`, value);
  }
}

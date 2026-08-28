# Theme Catalogs

RecallStack builds its theme list from up to three layers. The first layer that
claims a given theme `id` wins.

1. **Built-in catalog** — `builtin-themes.json`, compiled into the app. This is
   the shipped set (the **Blazory** and **Omarchy** groups). It always loads and
   cannot be replaced by a file in a workspace.
2. **`theme.json` overlay** — optional user additions, merged on top of the
   built-ins. RecallStack looks for `theme.json` beside the executable, then
   `<workspace>/Apps/theme.json`, then the bundled copy-me sample. Themes whose
   `id` collides with a built-in are ignored. The portable archive ships a small
   two-theme `theme.json` next to the executable so the format is easy to copy.
3. **External theme file** — a JSON file chosen in **Settings → External theme
   file**, merged last. See `external-themes.sample.json` and the **Use sample
   themes** button.

Restart RecallStack after editing any of these. If `builtin-themes.json` cannot
be read, RecallStack falls back to a single embedded Catppuccin palette so
startup is never blocked. RecallStack never rewrites any of these files.

## File Format

`builtin-themes.json`, and a full `theme.json`, use this structure:

```json
{
  "version": 1,
  "defaultTheme": "vapor",
  "themes": []
}
```

A `theme.json` overlay or an external theme file may instead be a bare array of
theme entries, or `{ "themes": [ ... ] }` with no `defaultTheme`.

Each theme has selector metadata and a CSS-variable palette:

```json
{
  "id": "example-night",
  "name": "Example Night",
  "group": "Custom",
  "mode": "dark",
  "variables": {
    "--base": "#1e1e2e",
    "--mantle": "#181825",
    "--crust": "#11111b",
    "--surface0": "#313244",
    "--surface1": "#45475a",
    "--surface2": "#585b70",
    "--overlay0": "#6c7086",
    "--overlay1": "#7f849c",
    "--subtext0": "#a6adc8",
    "--subtext1": "#bac2de",
    "--text": "#cdd6f4",
    "--lavender": "#b4befe",
    "--blue": "#89b4fa",
    "--sapphire": "#74c7ec",
    "--green": "#a6e3a1",
    "--yellow": "#f9e2af",
    "--peach": "#fab387",
    "--red": "#f38ba8",
    "--mauve": "#cba6f7",
    "--pink": "#f5c2e7"
  }
}
```

## Rules

- `id` must be unique and contain lowercase letters, numbers, and hyphens only.
- `name` is the text displayed in the theme selector.
- `group` creates or selects a theme-selector group.
- `mode` must be `light` or `dark`; RecallStack no longer guesses mode from the ID.
- Every base palette variable shown above is required and must be a six-digit hex colour.
- Additional supported variables — button, navigation, date-picker, glow, and font
  variables — are optional. The built-in themes provide examples.
- Every shipped built-in theme uses a distinct colour for each of the twenty base
  roles; no colour is reused for two roles.
- `defaultTheme` must match one of the theme IDs (full-catalog form only).
- A full catalog is limited to 200 themes and 1 MB; an overlay or external file to 100.

# External Theme Catalog

RecallStack loads its editable theme catalog from:

```text
<workspace>/Apps/themes.json
```

When a workspace does not contain this file, RecallStack copies the bundled default catalog into `Apps/themes.json`. The generated file contains every standard theme and can be edited with any text editor. Restart RecallStack after editing; the desktop app also reloads the catalog automatically when its native watcher observes a saved change.

## File Format

The catalog is JSON with this top-level structure:

```json
{
  "version": 1,
  "defaultTheme": "catppuccin",
  "themes": []
}
```

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
- Every base palette variable shown above is required.
- Additional supported variables, such as button, navigation, date-picker, glow, and font variables, are optional. Existing themes in `themes.json` provide examples.
- `defaultTheme` must match one of the theme IDs.
- The catalog is limited to 200 themes and 1 MB.

If the workspace catalog is invalid, RecallStack reports the validation error and uses its bundled catalog. It does not overwrite an invalid existing file. A minimal built-in Catppuccin palette remains available if both catalogs fail.

/**
 * Single source of truth for RecallStack's keyboard shortcuts.
 *
 * The runtime's global `keydown` handler is still imperative, but every place a
 * shortcut is *shown* to the user — command-palette `shortcut` badges, hover
 * tooltips on buttons, and the `Ctrl+K` keybinding cheat sheet — reads from this
 * module so the displayed keys and the real bindings never drift apart.
 *
 * Letter keys are matched case-insensitively in the handler (`e.key.toLowerCase()`);
 * the `combo` strings here are the conventional display form.
 */

export type KeymapCategory =
  | "Global"
  | "Files & Tabs"
  | "Navigation"
  | "Views & Panels"
  | "Editor";

export interface KeyBinding {
  /** Stable id. Matches a command-registry id when one exists. */
  id: string;
  /** Display form, e.g. `"Ctrl+T"`. Alternatives separated by `" / "`. */
  combo: string;
  /** Short imperative label for the cheat sheet. */
  label: string;
  /** One-line explanation. */
  description: string;
  category: KeymapCategory;
  /** When the binding only applies while a note/task is open in the editor. */
  editorOnly?: boolean;
}

export const KEY_BINDINGS: readonly KeyBinding[] = [
  // ── Global ────────────────────────────────────────────────────────────────
  {
    id: "global.escape",
    combo: "Esc",
    label: "Close overlay / go to journal",
    description:
      "Closes any open palette or modal and returns to the current file. With nothing open, saves and jumps to today's Daily Journal.",
    category: "Global",
  },
  {
    id: "global.keybindings",
    combo: "Ctrl+K",
    label: "Keyboard shortcuts",
    description: "Open this keybinding reference.",
    category: "Global",
  },
  {
    id: "command.palette",
    combo: "Ctrl+P",
    label: "Command palette",
    description: "Toggle the command palette in command-search (>) mode.",
    category: "Global",
  },
  {
    id: "view.theme",
    combo: "Ctrl+Shift+T",
    label: "Theme switcher",
    description: "Browse themes with a live preview; Enter applies.",
    category: "Global",
  },
  {
    id: "notes.list",
    combo: "Ctrl+L",
    label: "Notes listing",
    description: "Browse the current folder's notes in a listing modal.",
    category: "Navigation",
  },
  {
    id: "tools.import",
    combo: "Ctrl+I",
    label: "Open / import files",
    description: "Open the Open / Import Files dialog.",
    category: "Global",
  },

  // ── Files & Tabs ─────────────────────────────────────────────────────────
  {
    id: "file.new",
    combo: "Ctrl+N",
    label: "New file",
    description: "Open the new-file picker: Note, Task, or Working Task.",
    category: "Files & Tabs",
  },
  {
    id: "file.save",
    combo: "Ctrl+S",
    label: "Save",
    description: "Save the current note, task, or working task.",
    category: "Files & Tabs",
    editorOnly: true,
  },
  {
    id: "tabs.close",
    combo: "Ctrl+Q / Ctrl+Shift+W",
    label: "Close tab",
    description: "Close the current tab.",
    category: "Files & Tabs",
  },
  {
    id: "navigation.next-tab",
    combo: "Ctrl+Tab",
    label: "Next tab",
    description: "Switch to the next open tab.",
    category: "Files & Tabs",
  },
  {
    id: "navigation.previous-tab",
    combo: "Ctrl+Shift+Tab",
    label: "Previous tab",
    description: "Switch to the previous open tab.",
    category: "Files & Tabs",
  },
  {
    id: "tabs.jump",
    combo: "Ctrl+1 … Ctrl+9",
    label: "Jump to tab",
    description: "Activate the tab in that position (1 = leftmost).",
    category: "Files & Tabs",
  },
  {
    id: "tabs.quick-switch",
    combo: "Ctrl+Space",
    label: "Quick open tabs",
    description: "Toggle the quick tab switcher.",
    category: "Files & Tabs",
  },

  // ── Navigation ──────────────────────────────────────────────────────────
  {
    id: "navigation.today",
    combo: "Ctrl+J",
    label: "Daily Journal",
    description: "Open or focus today's Daily Journal.",
    category: "Navigation",
  },
  {
    id: "tasks.list",
    combo: "Ctrl+T",
    label: "Task listing",
    description: "Toggle the workspace Task listing modal.",
    category: "Navigation",
  },
  {
    id: "tasks.working-list",
    combo: "Ctrl+W",
    label: "Working Task listing",
    description: "Toggle the Working Task listing modal.",
    category: "Navigation",
  },
  {
    id: "navigation.search",
    combo: "Ctrl+/ / Ctrl+Shift+F",
    label: "Focus search",
    description: "Focus the workspace search box.",
    category: "Navigation",
  },
  {
    id: "navigation.search-reopen",
    combo: "Ctrl+F",
    label: "Reopen search",
    description: "Reopen buffered search results, or the quick search box.",
    category: "Navigation",
  },

  // ── Views & Panels ─────────────────────────────────────────────────────
  {
    id: "view.presentation",
    combo: "F12",
    label: "Presentation mode",
    description: "Toggle presentation mode.",
    category: "Views & Panels",
    editorOnly: true,
  },
  {
    id: "view.reading-toggle",
    combo: "I",
    label: "Edit / preview",
    description:
      "A note opens in the preview; I (insert) switches to editing and Esc switches back.",
    category: "Views & Panels",
    editorOnly: true,
  },
  {
    id: "view.zoom-in",
    combo: "Ctrl++",
    label: "Zoom in",
    description: "Increase editor and preview zoom.",
    category: "Views & Panels",
  },
  {
    id: "view.zoom-out",
    combo: "Ctrl+-",
    label: "Zoom out",
    description: "Decrease editor and preview zoom.",
    category: "Views & Panels",
  },
  {
    id: "view.zoom-reset",
    combo: "Ctrl+0",
    label: "Reset zoom",
    description: "Reset editor and preview zoom to 100%.",
    category: "Views & Panels",
  },

  // ── Editor ─────────────────────────────────────────────────────────────
  {
    id: "editor.undo",
    combo: "Ctrl+Z / Ctrl+Shift+Z",
    label: "Undo / redo",
    description: "Undo or redo editor changes (up to 50 steps), including list, indent, and blockquote edits.",
    category: "Editor",
    editorOnly: true,
  },
  {
    id: "editor.delete-line",
    combo: "Ctrl+D",
    label: "Delete line",
    description: "Delete the current line.",
    category: "Editor",
    editorOnly: true,
  },
  {
    id: "editor.blockquote",
    combo: "Ctrl+'",
    label: "Toggle blockquote",
    description: "Toggle blockquote on the selected lines.",
    category: "Editor",
    editorOnly: true,
  },
  {
    id: "editor.indent",
    combo: "Tab / Shift+Tab",
    label: "Indent / outdent",
    description: "Indent or outdent the selection; continues lists on Enter.",
    category: "Editor",
    editorOnly: true,
  },
] as const;

export const KEYMAP_BY_ID: ReadonlyMap<string, KeyBinding> = new Map(
  KEY_BINDINGS.map(binding => [binding.id, binding]),
);

export const KEYMAP_CATEGORY_ORDER: readonly KeymapCategory[] = [
  "Global",
  "Files & Tabs",
  "Navigation",
  "Views & Panels",
  "Editor",
];

/** Display combo for a binding id, or `undefined` if it has no shortcut. */
export function comboFor(id: string): string | undefined {
  return KEYMAP_BY_ID.get(id)?.combo;
}

/** Bindings grouped and ordered for the cheat sheet. */
export function bindingsByCategory(): { category: KeymapCategory; bindings: KeyBinding[] }[] {
  return KEYMAP_CATEGORY_ORDER.map(category => ({
    category,
    bindings: KEY_BINDINGS.filter(binding => binding.category === category),
  })).filter(group => group.bindings.length > 0);
}

/** Guards against two bindings claiming the exact same combo string. */
export function duplicateCombos(): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { combo } of KEY_BINDINGS) {
    for (const part of combo.split(" / ")) {
      const key = part.trim().toLowerCase();
      if (seen.has(key)) duplicates.add(part.trim());
      seen.add(key);
    }
  }
  return [...duplicates];
}

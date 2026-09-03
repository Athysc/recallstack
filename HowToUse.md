# RecallStack — How to Use

RecallStack is a desktop notes/tasks/journal app. Everything you write is a plain Markdown file on your computer — the app just gives you a fast, organized way to browse and edit them.

## Opening a Workspace

Click **Open Workspace** and pick a folder. That folder becomes your workspace root and is remembered for next time.

## How the UI Maps to Your Files

```
workspace-root/
├── Data/
│   └── [your-workspace-name]/
│       ├── tasks/            ← "Task listing" icon / Ctrl+T — all your tasks
│       │   └── working/      ← "Working Task listing" icon / Ctrl+W
│       ├── dailylogs/        ← "Daily Journal" icon / Ctrl+J
│       │   └── YYYY/MM/      ← one file per day, auto-organized by month
│       ├── [Folder Name]/    ← a button in Nav Row 1 (top of screen)
│       │   ├── [Subfolder]/  ← a button in Nav Row 2 (appears once you pick a folder)
│       │   ├── assets/       ← images/attachments you drag-drop into a note
│       │   └── archived/     ← notes you've archived (toggle with Archive icon)
│       └── ...                 (add as many top-level folders as you like)
└── DB/
    └── index.db             ← search index — safe to delete, it rebuilts itself
```

**Rule of thumb:** every button in the top navigation bars is just a folder, and every file card in the list is a Markdown file. Renaming/moving in the UI renames/moves the real file on disk.

## The Essentials

| UI Element | What it does |
|---|---|
| **Nav Row 1** (top folder buttons) | Pick a top-level folder in the current workspace — opens its Notes listing modal |
| **Workspace switcher** (chips, top-left) | Switch workspace. The Extra Data Folder, if set, comes after the `Data/` workspaces; the `sys` workspace, if set, is last |
| **Nav Row 2** (subfolder buttons) | Pick a subfolder — opens its Notes listing modal |
| **root** button | Shows notes saved directly in the folder (not in any subfolder) |
| **Ctrl+L** | Notes listing modal for the current folder (sort + archived toggle) |
| **Task listing icon / Ctrl+T** | Modal list of `tasks/`, grouped by status, color-coded by priority; **→ Working** / **Archive** per row |
| **Working Task listing icon / Ctrl+W** | Same for `tasks/working/`, with a **← Task** toggle per row |
| **Daily Journal icon / Ctrl+J** | Opens/creates today's entry in `dailylogs/` |
| **Search box / Ctrl+/** | Full-text search across every note (3+ characters) |
| **Ctrl+K** | Keyboard-shortcut reference sheet |
| **`I`** / **`Esc`** | A note opens in the preview; **`I`** switches to editing, **`Esc`** switches back |
| **Ctrl+P** | Command palette — run any command, or search notes (`@`) / tags (`#`) |
| **Ctrl+Shift+T** | Theme switcher with live preview |
| **Ctrl+Z / Ctrl+Shift+Z** | Undo / redo in the editor (up to 50 steps) |
| **Ctrl+Space** | Switch between your currently open tabs |
| **+ button / Ctrl+N** | Create a new Note, Task, or Working Task |
| **Task icon (editor toolbar)** | Converts the current note into a task |
| **Convert to Note icon** *(tasks only)* | Picks a folder/subfolder and moves the task there as a regular note, stripping its task metadata from the filename |
| **Archive icon** | Moves the note to that folder's `archived/` subfolder |
| **Trash icon** | Moves the note to the system trash (Recycle Bin / Trash) |
| **Calendar icon** | Shows tasks by Start/Due/Completed date |
| **Outputs icon** | Opens a separate configured export/output folder |

## Extra Data Folder & System Folder

**Settings → Extra Data Folder** points RecallStack at any folder on disk outside the workspace `Data/` tree. It appears in the workspace switcher **after the `Data/` workspaces** (just before `sys`, if that's set) and works like one — its subfolders are Nav Row 1, and browse / open / edit / create / rename / move / archive / delete all behave normally. It persists across sessions; **Clear** removes it.

**Settings → System folder** points at the directory holding `ai-team`, `openbrain`, `ai-team-shared`, and `openbrain-shared`. When set, a **`sys` workspace appears last** in the switcher, with those folders as its top-level folders. (This replaces the old System Folders show/hide toggle.) You switch into `sys` by click — RecallStack never lands there on its own.

Limitations for both: notes are **not** in search, the calendar, backlinks, or `[[wikilink]]` completion, and there are no Tasks. The **Daily Journal works** in both — it's the shared `Data/dailylogs/` journal.

## The editor

A note opens showing only the rendered **Preview**. Press **`I`** to edit, **`Esc`** to go back to the preview (it re-renders once). Empty notes open ready to type. **Click a spot in the preview before pressing `I`** and the caret lands on that line (the block you clicked is briefly highlighted). The preview isn't rebuilt on every keystroke while you edit, which keeps typing fast in big notes; the **Presentation** button flips back to a fresh preview first. Line numbers are always shown. Each tab remembers whether it was in edit or preview mode.

## Saving

You almost never need to hit Save — RecallStack autosaves ~1.5 seconds after you stop typing, and immediately on switching files or minimizing the window. Manual **Save (Ctrl+S)** is only required to confirm a title/filename change.

**Esc** only undoes a mode: it closes an open palette or modal, exits presentation, and returns from editing to the preview. With nothing to exit it does nothing — press **Ctrl+J** to jump to today's Daily Journal.

## Getting Help In-App

Click the **Info icon** in the top bar for the full built-in User Guide, or the **Book icon** for Markdown syntax help.

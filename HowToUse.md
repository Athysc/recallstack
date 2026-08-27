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
| **Nav Row 1** (top folder buttons) | Switch between top-level folders in `Data/[workspace]/` |
| **Nav Row 2** (subfolder buttons) | Switch between subfolders of the selected top-level folder |
| **root** button | Shows notes saved directly in the folder (not in any subfolder) |
| **Task listing icon / Ctrl+T** | Modal list of every task in `tasks/`, with a **→ Working** toggle per row |
| **Working Task listing icon / Ctrl+W** | Same modal for `tasks/working/`, with a **← Task** toggle per row |
| **Daily Journal icon / Ctrl+J** | Opens/creates today's entry in `dailylogs/` |
| **Search box / Ctrl+/** | Full-text search across every note (3+ characters) |
| **Ctrl+K** | Keyboard-shortcut reference sheet |
| **Ctrl+P** | Command palette — run any command, or search notes (`@`) / tags (`#`) |
| **Ctrl+L** | Theme switcher with live preview |
| **Ctrl+Space** | Switch between your currently open tabs |
| **+ button / Ctrl+N** | Create a new Note, Task, or Working Task |
| **Task icon (editor toolbar)** | Converts the current note into a task |
| **Convert to Note icon** *(tasks only)* | Picks a folder/subfolder and moves the task there as a regular note, stripping its task metadata from the filename |
| **Archive icon** | Moves the note to that folder's `archived/` subfolder |
| **Trash icon** | Moves the note to recoverable Trash |
| **Calendar icon** | Shows tasks by Start/Due/Completed date |
| **Outputs icon** | Opens a separate configured export/output folder |

## Saving

You almost never need to hit Save — RecallStack autosaves ~1.5 seconds after you stop typing, and immediately on switching files or minimizing the window. Manual **Save (Ctrl+S)** is only required to confirm a title/filename change.

Press **Esc** with nothing open to save and jump to today's Daily Journal; with a palette or modal open it just closes that and returns you to the current file.

## Getting Help In-App

Click the **Info icon** in the top bar for the full built-in User Guide, or the **Book icon** for Markdown syntax help.

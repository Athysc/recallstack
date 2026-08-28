RecallStack Portable for Linux
==============================

Run ./recallstack from this directory. RecallStack requires GTK 3, WebKitGTK 4.1,
and the standard Tauri 2 Linux runtime libraries. On Arch Linux these are supplied
by gtk3 and webkit2gtk-4.1 (plus their dependencies).

Keep readme.md, changes.md, builtin-themes.json, and theme.json beside the recallstack executable.
They provide the in-app guide, change history, and editable theme catalog.

The included desktop file and icon may optionally be copied to the matching paths
under ~/.local/share. Settings are stored below the platform user-data directory
for com.recallstack.desktop. Notes remain in the selected workspace.

Upgrade: close RecallStack, replace the application files, and reopen the same
workspace. Back up the workspace before upgrades or downgrades. Downgrades are not
guaranteed after a newer release changes the rebuildable SQLite index schema.

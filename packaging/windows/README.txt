RecallStack Portable for Windows
================================

1. Extract the entire ZIP to a folder you can write to. Keep readme.md,
   changes.md, builtin-themes.json, and theme.json beside RecallStack.exe.
2. Run RecallStack.exe. No installation or administrator access is required.
3. Choose a workspace folder containing Data/ when prompted.

RecallStack uses the Microsoft Edge WebView2 Evergreen Runtime normally included
with supported Windows 10 and Windows 11 systems. If the window does not open,
install or repair WebView2 from Microsoft's official download page.

Settings and recent-workspace history are stored per user under the Windows local
application-data directory for com.recallstack.desktop. Notes remain in the
workspace you select. Back up that workspace independently.

Upgrade: close RecallStack, replace RecallStack.exe, and reopen your workspace.
The Windows artifact may be unsigned; Windows SmartScreen may show a warning.

readme.md, changes.md, and theme.json are editable; builtin-themes.json is a copy of the embedded theme catalog. Restart RecallStack after editing theme.json.

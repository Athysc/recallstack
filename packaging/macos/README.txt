RecallStack Portable for macOS
===============================

1. Extract the entire ZIP to a folder you can write to. Keep readme.md,
   changes.md, and theme.json beside RecallStack.app.
2. The universal RecallStack.app runs on both Apple Silicon and Intel Macs.
   No installation or administrator access is required.
3. Choose a workspace folder containing Data/ when prompted.

RecallStack.app is not signed with an Apple Developer ID and is not notarized.
The first time you open it, Gatekeeper will refuse to launch it normally.
Either:

  - Right-click (or Control-click) RecallStack.app, choose Open, then confirm
    Open again in the dialog that appears, or
  - Run `xattr -cr RecallStack.app` in Terminal from this folder to clear the
    quarantine flag, then double-click as usual.

RecallStack uses the WebKit engine built into macOS; no separate runtime
install is required.

Settings and recent-workspace history are stored per user under
~/Library/Application Support/com.recallstack.desktop. Notes remain in the
workspace you select. Back up that workspace independently.

Upgrade: close RecallStack, replace RecallStack.app, and reopen your workspace.

The three sidecar files are editable. Restart RecallStack after editing theme.json.

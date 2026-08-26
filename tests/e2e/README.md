# Desktop end-to-end and responsive layout coverage

The suite drives the built Tauri application through WebdriverIO and Tauri's
test-only embedded WebDriver. It copies `fixtures/workspace` to an ignored temporary directory,
so note edits never mutate the committed fixture.

The embedded server does not require `tauri-driver`, `WebKitWebDriver`, or an
Edge-driver installation, and supports Linux, Windows, and macOS. Linux still
requires a graphical display; in headless CI run the command through `xvfb-run`.
Both Rust plugins and their permissions are enabled only by the `e2e` Cargo
feature and the dedicated `tauri.e2e.conf.json` overlay.

Run the smoke and responsive layout checks with:

```sh
npm run test:frontend:e2e
```

On Windows, run the opt-in long-idle regression with:

```powershell
npm run test:windows-idle:performance
```

That release-build test minimizes RecallStack for six minutes so WebView2 can
enter its real background-suspension path, mutates 250 synthetic workspace
files while hidden, restores the window, and enforces a 1.5-second first-input
budget. Set `RECALLSTACK_WINDOWS_IDLE_MS` to a smaller value only for local
test development; the default six-minute duration is the regression test.

`npm run verify:frontend` also runs this suite when Linux and `xvfb-run` are
available; otherwise it prints an explicit skip and leaves the native gate to
the dedicated Linux CI workflow. This keeps ordinary Windows/macOS release
verification valid when the required Linux display tooling is unavailable.

The suite does not use pixel-by-pixel baseline matching. It verifies exact
viewport sizes, viewport intersection for required visible elements, complete
theme variables, and functional behavior. Diagnostic screenshots are still captured
under `.visual-output/` and uploaded as the
`frontend-e2e-diagnostic-screenshots` artifact when CI fails.

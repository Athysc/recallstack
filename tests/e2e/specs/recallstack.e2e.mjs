import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspacePath = resolve(import.meta.dirname, "../.workspace");
const screenshotPath = resolve(import.meta.dirname, "../.visual-output/actual");
const themeCatalog = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../themes.json"), "utf8"));
const themeBaseColors = new Map(themeCatalog.themes.map(theme => [theme.id, theme.variables["--base"]]));
const viewportSizes = [
  { width: 900, height: 620, tag: "compact" },
  { width: 1280, height: 800, tag: "standard" },
  { width: 1600, height: 1000, tag: "wide" },
];

async function waitForVisible(selector) {
  const element = await $(selector);
  await element.waitForDisplayed();
  return element;
}

// Opens a document as a pinned tab (the app's Ctrl+click convention). A
// synthetic click carries ctrlKey through to the app's own click handlers
// without depending on real OS-level modifier-key state.
async function ctrlClick(element) {
  await browser.execute(el => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })), element);
}

async function setViewport(size) {
  await browser.tauri.execute(async ({ core }, value) => {
    await core.invoke("plugin:window|unmaximize", { label: "main" });
    await core.invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width: value.width, height: value.height } },
    });
  }, size);
  let viewport;
  await browser.waitUntil(async () => {
    viewport = await browser.execute(() => ({ width: window.innerWidth, height: window.innerHeight }));
    return viewport.width === size.width && viewport.height === size.height;
  }, {
    timeout: 5_000,
    timeoutMsg: `window did not resize to ${size.width}x${size.height} in time (last seen ${viewport?.width}x${viewport?.height})`,
  });
  expect(viewport.width).toBe(size.width);
  expect(viewport.height).toBe(size.height);
}

async function verifyLayoutAtAllSizes(tag, selectors) {
  for (const size of viewportSizes) {
    await setViewport(size);
    await browser.execute(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await browser.pause(100);
    const layout = await browser.execute(requiredSelectors => ({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      elements: requiredSelectors.map(selector => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) return { selector, found: false };
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          selector,
          found: true,
          visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0,
          bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        };
      }),
    }), selectors);
    mkdirSync(screenshotPath, { recursive: true });
    await browser.saveScreenshot(resolve(screenshotPath, `${tag}-${size.tag}-${size.width}x${size.height}.png`));

    expect(layout.viewport).toEqual({ width: size.width, height: size.height });
    const layoutErrors = [];
    for (const element of layout.elements) {
      if (!element.found) {
        layoutErrors.push(`${element.selector}: element was not found`);
        continue;
      }
      if (!element.visible) layoutErrors.push(`${element.selector}: element is hidden`);
      if (element.bounds.width <= 0 || element.bounds.height <= 0) {
        layoutErrors.push(`${element.selector}: element has no rendered area (${JSON.stringify(element.bounds)})`);
      }
      const intersectsViewport = element.bounds.right > 0
        && element.bounds.bottom > 0
        && element.bounds.left < size.width
        && element.bounds.top < size.height;
      if (!intersectsViewport) {
        layoutErrors.push(`${element.selector}: element is outside the ${size.width}x${size.height} viewport (${JSON.stringify(element.bounds)})`);
      }
    }
    if (layoutErrors.length > 0) {
      throw new Error(`Responsive layout check failed for ${tag} at ${size.width}x${size.height}:\n- ${layoutErrors.join("\n- ")}`);
    }
  }
}

async function pressControlSpace() {
  // A synthetic document.dispatchEvent(KeyboardEvent) here reliably fails to
  // open the switcher under WebKitGTK in CI (Xvfb, no compositor), even
  // though the same shortcut works when sent as a real WebDriver key press
  // (as used elsewhere in this spec). Route through the real input pipeline
  // so behavior matches what an actual user triggers.
  await browser.keys(["Control", " "]);
}

async function clickButtonWithText(container, text) {
  const buttons = await $$(`${container} button`);
  let button;
  for (const candidate of buttons) {
    if ((await candidate.getText()).trim().includes(text)) {
      button = candidate;
      break;
    }
  }
  if (!button) throw new Error(`Could not find a ${container} button containing “${text}”`);
  await button.waitForClickable();
  await button.click();
  return button;
}

describe("RecallStack desktop smoke flow", () => {
  it("covers workspace, notes, tasks, calendar, outputs, themes, and visual states", async () => {
    await browser.execute(() => localStorage.clear());
    await browser.refresh();
    await waitForVisible("#welcome");
    await verifyLayoutAtAllSizes("welcome", ["#welcome", ".welcome-card", "#btn-open-workspace"]);

    await browser.execute(path => {
      localStorage.clear();
      localStorage.setItem("recallstack-desktop-workspace-path", path);
      // This smoke flow asserts the live editor+preview split and its visual
      // baselines; pin the classic editor mode. Reading mode has its own test.
      localStorage.setItem("pkm-editor-mode", "classic");
    }, workspacePath);
    await browser.refresh();
    await waitForVisible("#app");
    expect((await $$("#md-editor .cm-editor")).length).toBe(0);
    const nativeBulkSnapshot = await browser.tauri.execute(async ({ core }) => {
      const files = await core.invoke("fs_list_recursive", { path: "openbrain/outputs/reports" });
      const references = await core.invoke("fs_referenced_assets", { path: "Data/personal/project/notes" });
      return { files, references };
    });
    expect(nativeBulkSnapshot.files.some(file => file.path.toLowerCase().endsWith("report.md"))).toBe(true);
    expect(Array.isArray(nativeBulkSnapshot.references)).toBe(true);
    const assetBytes = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,8,215,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130];
    await browser.tauri.execute(async ({ core }, bytes) => {
      await core.invoke("fs_write", { path: "Data/personal/project/notes/assets/protocol-smoke.png", bytes });
    }, assetBytes);
    const streamedAsset = await browser.execute(async () => {
      const url = window.__recallstackNative.assetUrl("Data/personal/project/notes/assets/protocol-smoke.png");
      const transferredBefore = window.__recallstackNative.performanceSnapshot().transferredBytes;
      const response = await fetch(url);
      const partial = await fetch(url, { headers: { Range: "bytes=2-5" } });
      const transferredAfter = window.__recallstackNative.performanceSnapshot().transferredBytes;
      return {
        ok: response.ok,
        type: response.headers.get("content-type"),
        size: (await response.arrayBuffer()).byteLength,
        partialStatus: partial.status,
        partialSize: (await partial.arrayBuffer()).byteLength,
        bridgeBytes: transferredAfter - transferredBefore,
      };
    });
    expect(streamedAsset).toEqual({ ok: true, type: "image/png", size: assetBytes.length, partialStatus: 206, partialSize: 4, bridgeBytes: 0 });
    await clickButtonWithText("#nav-row-1", "project");
    await clickButtonWithText("#nav-row-2", "notes");
    await waitForVisible("#file-grid .file-card");
    await verifyLayoutAtAllSizes("file-list", ["#app", "#file-list-view", "#file-grid .file-card"]);

    let noteCard;
    for (const candidate of await $$("#file-grid .file-card")) {
      if ((await candidate.getText()).includes("Welcome Note")) {
        noteCard = candidate;
        break;
      }
    }
    if (!noteCard) throw new Error("Welcome Note card was not rendered");
    await noteCard.waitForClickable();
    // Ctrl+click pins this tab so it survives the later dynamic-tab opens
    // (calendar journal entry) instead of being replaced by them.
    await ctrlClick(noteCard);
    await waitForVisible("#editor-view");
    await waitForVisible("#md-editor .cm-editor");

    const editor = await $("#md-editor .cm-content");
    await editor.click();
    await editor.setValue("# Welcome Note\n\nThis note exercises the editor and preview smoke path.\n\n- first item\n- second item\n\nSmoke edit\n");
    await browser.waitUntil(async () => {
      const editorText = await $("#md-editor .cm-content").getText();
      const previewText = await $("#preview-output").getText();
      return editorText.includes("Smoke edit") && previewText.includes("Smoke edit");
    }, { timeout: 10_000, timeoutMsg: "edited content did not finish rendering" });
    await browser.keys(["Control", "Home"]);
    await verifyLayoutAtAllSizes("note-editor", ["#editor-view", "#editor-toolbar", "#md-editor .cm-editor", "#preview-output"]);
    await $("#btn-save").click();
    await browser.waitUntil(async () => (await $("#toast").getText()).includes("Saved"), {
      timeout: 10_000,
      timeoutMsg: "note did not report a successful save",
    });
    expect(readFileSync(resolve(workspacePath, "Data/personal/project/notes/Welcome Note.md"), "utf8")).toContain("Smoke edit");

    // Regression: returning to a list leaves the current document tab active.
    // Clicking that file again must reveal the editor instead of taking the
    // old active-tab fast path and appearing to do nothing.
    await clickButtonWithText("#nav-row-2", "notes");
    await waitForVisible("#file-grid .file-card");
    let alreadyOpenNoteCard;
    for (const candidate of await $$("#file-grid .file-card")) {
      if ((await candidate.getText()).includes("Welcome Note")) {
        alreadyOpenNoteCard = candidate;
        break;
      }
    }
    if (!alreadyOpenNoteCard) throw new Error("Already-open Welcome Note card was not rendered");
    await alreadyOpenNoteCard.click();
    await waitForVisible("#editor-view");
    expect(await $("#title-input").getValue()).toBe("Welcome Note");

    await clickButtonWithText("#nav-row-2", "notes");
    await waitForVisible("#file-grid .file-card");
    const returnToTabButton = await $("#btn-return-to-tab");
    expect(await returnToTabButton.isEnabled()).toBe(true);
    expect(await returnToTabButton.getAttribute("title")).toContain("Welcome Note");
    await returnToTabButton.click();
    await waitForVisible("#editor-view");
    expect(await $("#title-input").getValue()).toBe("Welcome Note");

    await clickButtonWithText("#nav-row-2", "tasks");
    await waitForVisible("#file-grid .file-card");
    await verifyLayoutAtAllSizes("tasks", ["#file-list-view", "#file-grid .file-card"]);

    await $("#btn-calendar").click();
    await waitForVisible("#calendar-view");
    await verifyLayoutAtAllSizes("calendar", ["#calendar-view", "#cal-grid"]);

    const calendarDay = await $("#cal-grid .cal-day:not(.other-month)");
    const calendarDate = await calendarDay.getAttribute("data-date");
    await calendarDay.click();
    const journalButton = await waitForVisible("#cal-task-panel .cal-journal-card");
    expect(await journalButton.getText()).toContain("Journal / Daily Log");
    const firstCalendarItemClass = await browser.execute(() =>
      document.querySelector("#cal-task-panel .cal-task-card")?.className || "");
    expect(firstCalendarItemClass).toContain("cal-journal-card");
    await journalButton.click();
    await waitForVisible("#editor-view");
    const calendarDateKey = calendarDate.replaceAll("-", "");
    expect(await $("#title-input").getValue()).toBe(`journal-${calendarDateKey}`);
    const [calendarYear, calendarMonth] = calendarDate.split("-");
    const calendarJournal = await browser.tauri.execute(async ({ core }, path) =>
      core.invoke("fs_stat", { path }), `Data/personal/project/tasks/journal/${calendarYear}/${calendarMonth}/journal-${calendarDateKey}.md`);
    expect(calendarJournal).not.toBeNull();

    // Pinned (Ctrl+clicked) tabs persist; a plain click retargets the single
    // dynamic tab instead of accumulating one per click, so exactly two tabs
    // are open here: Welcome Note (pinned) and the dynamic journal tab.
    const tabStripItems = await $$("#tab-strip .tab-strip-item");
    expect(tabStripItems.length).toBe(2);
    const tabStripClasses = await Promise.all(tabStripItems.map(item => item.getAttribute("class")));
    expect(tabStripClasses.filter(cls => cls.includes("pinned")).length).toBe(1);

    // Ctrl+Space exposes every open tab, starts on the active one, supports
    // arrow/Vim selection, immediate letter-code jumps, X close, and Escape.
    await pressControlSpace();
    const quickTabs = await waitForVisible("#quick-tab-switcher");
    expect((await $$("#quick-tab-results .quick-tab-item")).length).toBeGreaterThanOrEqual(2);
    expect(await $("#quick-tab-results .quick-tab-item[aria-selected=\"true\"] .quick-tab-title").getText()).toBe(`journal-${calendarDateKey}`);
    await browser.keys("k");
    await browser.keys("Enter");
    await quickTabs.waitForDisplayed({ reverse: true });
    expect(await $("#title-input").getValue()).toBe("Welcome Note");

    await pressControlSpace();
    await waitForVisible("#quick-tab-switcher");
    await browser.keys("j");
    expect(await $("#quick-tab-results .quick-tab-item[aria-selected=\"true\"] .quick-tab-title").getText()).toBe(`journal-${calendarDateKey}`);
    await browser.keys("Enter");
    await quickTabs.waitForDisplayed({ reverse: true });
    expect(await $("#title-input").getValue()).toBe(`journal-${calendarDateKey}`);

    await pressControlSpace();
    await waitForVisible("#quick-tab-switcher");
    const welcomeCode = await browser.execute(title => {
      const rows = [...document.querySelectorAll("#quick-tab-results .quick-tab-item")];
      return rows.find(row => row.querySelector(".quick-tab-title")?.textContent === title)?.querySelector(".quick-tab-code")?.textContent || "";
    }, "Welcome Note");
    expect(welcomeCode).not.toBe("");
    expect(/[JKX]/.test(welcomeCode)).toBe(false);
    await browser.keys(welcomeCode);
    await quickTabs.waitForDisplayed({ reverse: true });
    expect(await $("#title-input").getValue()).toBe("Welcome Note");

    await $("#title-input").click();
    await pressControlSpace();
    await waitForVisible("#quick-tab-switcher");
    await browser.keys("Escape");
    await quickTabs.waitForDisplayed({ reverse: true });
    expect(await browser.execute(() => document.activeElement?.id)).toBe("title-input");

    await pressControlSpace();
    await waitForVisible("#quick-tab-switcher");
    await browser.keys("j");
    await browser.keys("x");
    expect(await quickTabs.isDisplayed()).toBe(true);
    expect((await $$("#quick-tab-results .quick-tab-item")).length).toBe(1);
    expect((await $$("#tab-strip .tab-strip-item")).length).toBe(1);
    await browser.keys("x");
    await quickTabs.waitForDisplayed({ reverse: true });
    expect((await $$("#tab-strip .tab-strip-item")).length).toBe(0);

    await clickButtonWithText("#nav-row-1", "Outputs");
    await waitForVisible("#nav-row-2");
    await clickButtonWithText("#nav-row-2", "reports");
    await waitForVisible("#file-grid .file-card");
    const recursiveListCalls = await browser.execute(() => window.__recallstackNative.performanceSnapshot().calls.fs_list_recursive?.count || 0);
    expect(recursiveListCalls).toBeGreaterThan(0);
    await verifyLayoutAtAllSizes("outputs", ["#file-list-view", "#file-grid .file-card"]);

    await $("#btn-settings").click();
    await waitForVisible("#modal-settings");
    await verifyLayoutAtAllSizes("settings-modal", ["#modal-settings", ".settings-dialog", "#theme-select"]);

    const themeSelect = await $("#theme-select");
    const themeIds = [];
    for (const option of await themeSelect.$$("option")) themeIds.push(await option.getValue());
    await setViewport(viewportSizes[1]);
    for (const themeId of themeIds) {
      await browser.execute(id => {
        const select = document.querySelector("#theme-select");
        select.value = id;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, themeId);
      const expectedTheme = themeCatalog.themes.find(theme => theme.id === themeId);
      const appliedBase = await browser.execute(() => getComputedStyle(document.documentElement).getPropertyValue("--base").trim());
      expect(appliedBase).toBe(themeBaseColors.get(themeId));
      const appliedVariables = await browser.execute(keys => Object.fromEntries(keys.map(key =>
        [key, document.documentElement.style.getPropertyValue(key).trim()])), Object.keys(expectedTheme.variables));
      expect(appliedVariables).toEqual(expectedTheme.variables);
      await browser.execute(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      mkdirSync(screenshotPath, { recursive: true });
      await browser.saveScreenshot(resolve(screenshotPath, `theme-${themeId}-standard-1280x800.png`));
    }

    // Folder rename must stay inside one native operation instead of copying
    // every file through the WebView and recursively deleting the source.
    await $("#btn-settings-close").click();
    await clickButtonWithText("#nav-row-1", "project");
    await clickButtonWithText("#nav-row-2", "notes");
    await $("#btn-rename-folder-2").click();
    await waitForVisible("#modal-rename-folder");
    await $("#modal-rename-input").setValue("notes-renamed");
    await $("#modal-rename-apply-btn").click();
    await $("#modal-rename-folder").waitForDisplayed({ reverse: true });
    expect(await $("#nav-row-2").getText()).toContain("notes-renamed");
    await $("#btn-rename-folder-2").click();
    await $("#modal-rename-input").setValue("notes");
    await $("#modal-rename-apply-btn").click();
    await $("#modal-rename-folder").waitForDisplayed({ reverse: true });
    const renameCalls = await browser.execute(() => window.__recallstackNative.performanceSnapshot().calls.fs_rename?.count || 0);
    expect(renameCalls).toBeGreaterThanOrEqual(2);

    // All new Markdown entry points prompt with a selected default filename.
    // Escape must leave the filesystem untouched, while typing replaces the
    // selection and Enter creates an already-saved empty file.
    await $("#btn-new").click();
    await waitForVisible("#modal-new-file");
    expect(await $("#modal-new-file-title").getText()).toBe("New Note");
    const cancelledDefault = await $("#modal-new-file-name").getValue();
    expect(cancelledDefault.endsWith(".md")).toBe(false);
    await browser.waitUntil(() => browser.execute(() => {
      const input = document.querySelector("#modal-new-file-name");
      return document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length;
    }), { timeout: 2_000, timeoutMsg: "default filename was not focused and selected" });
    const modalState = await browser.execute(() => {
      const input = document.querySelector("#modal-new-file-name");
      const dialog = document.querySelector("#modal-new-file .modal-dialog");
      return {
        selected: document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length,
        widthRatio: dialog.getBoundingClientRect().width / window.innerWidth,
      };
    });
    expect(modalState.selected).toBe(true);
    expect(Math.abs(modalState.widthRatio - 0.6)).toBeLessThan(0.01);
    await browser.keys("Escape");
    await $("#modal-new-file").waitForDisplayed({ reverse: true });
    const cancelledStat = await browser.tauri.execute(async ({ core }, filename) =>
      core.invoke("fs_stat", { path: `Data/personal/project/notes/${filename}.md` }), cancelledDefault);
    expect(cancelledStat).toBeNull();

    await $("#btn-new").click();
    await waitForVisible("#modal-new-file");
    await browser.keys("Modal Prompt Note");
    expect(await $("#modal-new-file-name").getValue()).toBe("Modal Prompt Note");
    await browser.keys("Enter");
    await $("#modal-new-file").waitForDisplayed({ reverse: true });
    expect(await $("#title-input").getValue()).toBe("Modal Prompt Note");
    const customNote = await browser.tauri.execute(async ({ core }) => ({
      stat: await core.invoke("fs_stat", { path: "Data/personal/project/notes/Modal Prompt Note.md" }),
      text: await core.invoke("fs_read_text", { path: "Data/personal/project/notes/Modal Prompt Note.md" }),
    }));
    expect(customNote.stat).not.toBeNull();
    expect(customNote.text).toBe("");

    await clickButtonWithText("#nav-row-2", "tasks");
    await $("#btn-new").click();
    await waitForVisible("#modal-new-file");
    expect(await $("#modal-new-file-title").getText()).toBe("New Task");
    const taskDefault = await $("#modal-new-file-name").getValue();
    expect(taskDefault.endsWith(".md")).toBe(false);
    await browser.keys("Enter");
    await $("#modal-new-file").waitForDisplayed({ reverse: true });
    const defaultTaskFilename = `${taskDefault} -- s00000000_c00000000_due00000000_normal.md`;
    const defaultTaskText = await browser.tauri.execute(async ({ core }, filename) =>
      core.invoke("fs_read_text", { path: `Data/personal/project/tasks/${filename}` }), defaultTaskFilename);
    expect(defaultTaskText).toBe("");

    await $("#btn-new-working-task").click();
    await waitForVisible("#modal-new-file");
    expect(await $("#modal-new-file-title").getText()).toBe("New Working Task");
    expect((await $("#modal-new-file-name").getValue()).endsWith(".md")).toBe(false);
    await browser.keys("Modal Working Task");
    await browser.keys("Enter");
    await $("#modal-new-file").waitForDisplayed({ reverse: true });
    const workingTaskText = await browser.tauri.execute(async ({ core }) =>
      core.invoke("fs_read_text", { path: "Data/personal/project/tasks/working/Modal Working Task -- s00000000_c00000000_due00000000_normal.md" }));
    expect(workingTaskText).toBe("");

  });

  it("reading editor mode opens in preview, I edits, Esc returns to preview", async () => {
    await browser.execute(() => localStorage.clear());
    await browser.execute(path => {
      localStorage.setItem("recallstack-desktop-workspace-path", path);
      // No pkm-editor-mode set → the default reading mode is active.
    }, workspacePath);
    await browser.refresh();
    await waitForVisible("#app");
    await clickButtonWithText("#nav-row-1", "project");
    await clickButtonWithText("#nav-row-2", "notes");
    await waitForVisible("#file-grid .file-card");

    let noteCard;
    for (const candidate of await $$("#file-grid .file-card")) {
      if ((await candidate.getText()).includes("Welcome Note")) { noteCard = candidate; break; }
    }
    if (!noteCard) throw new Error("Welcome Note card was not rendered");
    await noteCard.waitForClickable();
    await noteCard.click();

    // Opens straight into the rendered preview; the editor pane is collapsed.
    await waitForVisible("#preview-output");
    const paneDisplay = selector => browser.execute(
      sel => getComputedStyle(document.querySelector(sel)).display, selector);
    await browser.waitUntil(async () => (await paneDisplay("#editor-pane")) === "none", {
      timeout: 5_000, timeoutMsg: "editor pane was not collapsed on open in reading mode",
    });

    // I (insert) switches to editing.
    await browser.keys(["i"]);
    await waitForVisible("#md-editor .cm-editor");
    expect(await paneDisplay("#preview-pane")).toBe("none");
    const editor = await $("#md-editor .cm-content");
    await editor.click();
    await editor.setValue("# Welcome Note\n\nReading-mode smoke edit\n");

    // While editing, the frozen preview must not have re-rendered.
    expect((await $("#preview-output").getText()).includes("Reading-mode smoke edit")).toBe(false);

    // Esc returns to the preview and renders once.
    await browser.keys(["Escape"]);
    await browser.waitUntil(async () => (await paneDisplay("#editor-pane")) === "none", {
      timeout: 5_000, timeoutMsg: "editor pane did not collapse after Escape",
    });
    await browser.waitUntil(
      async () => (await $("#preview-output").getText()).includes("Reading-mode smoke edit"),
      { timeout: 10_000, timeoutMsg: "preview did not refresh after returning from edit mode" },
    );
  });
});

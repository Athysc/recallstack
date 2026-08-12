import assert from "node:assert/strict";
import test from "node:test";
import { healthReportMarkdown, loadDocumentWithFallback } from "../../src/ui/components/documents.ts";
import { formatNativeProgress } from "../../src/services/native-progress.ts";
import { DependencyStatusController } from "../../src/ui/components/dependency-status.ts";
import { NewFileModalController } from "../../src/ui/components/new-file-modal.ts";

class FakeClassList {
  private readonly values = new Set<string>();
  add(...names: string[]) { names.forEach(name => this.values.add(name)); }
  remove(...names: string[]) { names.forEach(name => this.values.delete(name)); }
  contains(name: string) { return this.values.has(name); }
}

class FakeElement extends EventTarget {
  classList = new FakeClassList();
  textContent = "";
  value = "";
  disabled = false;
  focused = false;
  selected = false;
  focus() { this.focused = true; }
  blur() { this.focused = false; }
  select() { this.selected = true; }
}

function keyEvent(key: string): Event {
  const event = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "key", { value: key });
  return event;
}

test("portable documents prefer sidecar, then workspace, then bundle", async () => {
  const calls: string[] = [];
  const common = { portableName: "readme.md", workspaceName: "readme.md", warn: () => undefined };
  assert.equal(await loadDocumentWithFallback({
    ...common,
    readPortable: async () => "portable",
    readWorkspace: async () => { calls.push("workspace"); return "workspace"; },
    readBundled: async () => { calls.push("bundle"); return "bundle"; },
  }), "portable");
  assert.deepEqual(calls, []);

  assert.equal(await loadDocumentWithFallback({
    ...common,
    readPortable: async () => null,
    readWorkspace: async () => { throw new Error("missing"); },
    readBundled: async () => "bundle",
  }), "bundle");
});

test("health report markdown includes findings and paths", () => {
  assert.equal(healthReportMarkdown({ notes: 2, watcher: "healthy", findings: [] }),
    "# RecallStack Workspace Health\n\nNotes: 2\n\nWatcher: healthy\n\n## Findings\n\n- No findings\n");
  assert.match(healthReportMarkdown({
    findings: [{ severity: "warning", code: "ORPHAN", path: "notes/a.md", message: "Missing asset" }],
  }), /\*\*warning\*\* ORPHAN — `notes\/a\.md`: Missing asset/);
});

test("native progress messages tolerate partial payloads", () => {
  assert.equal(formatNativeProgress("Indexing", { completed: 3, total: 10, path: "notes/a.md" }),
    "Indexing 3 of 10: notes/a.md");
  assert.equal(formatNativeProgress("Backing up", {}), "Backing up 0 of 0: ");
});

test("dependency status controller renders native and error states", () => {
  const list = { innerHTML: "" } as HTMLElement;
  const errorLine = { textContent: "", title: "" } as HTMLElement;
  const controller = new DependencyStatusController(list, errorLine, { marked: "local", sql: "native" });
  controller.render();
  assert.match(list.innerHTML, /data-dep="sql"[^>]+data-source="native"/);
  controller.set("mermaid", { state: "missing", errorText: "Renderer unavailable" });
  assert.equal(errorLine.textContent, "Renderer unavailable");
});

test("new-file modal selects defaults, cancels on Escape, and submits custom names", async () => {
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => { callback(0); return 1; };
  try {
    const overlay = new FakeElement();
    const title = new FakeElement();
    const input = new FakeElement();
    const error = new FakeElement();
    const cancelButton = new FakeElement();
    const createButton = new FakeElement();
    overlay.classList.add("hidden");
    const created: string[] = [];
    const modal = new NewFileModalController({
      overlay, title, input, error, cancelButton, createButton,
    } as never);

    modal.open({
      title: "New Note",
      defaultFilename: "2026-08-10",
      async create(filename) { created.push(filename); return null; },
    });
    assert.equal(overlay.classList.contains("hidden"), false);
    assert.equal(title.textContent, "New Note");
    assert.equal(input.value, "2026-08-10");
    assert.equal(input.focused, true);
    assert.equal(input.selected, true);
    input.dispatchEvent(keyEvent("Escape"));
    assert.equal(overlay.classList.contains("hidden"), true);
    assert.deepEqual(created, []);

    modal.open({
      title: "New Working Task",
      defaultFilename: "2026-08-10",
      async create(filename) { created.push(filename); return null; },
    });
    input.value = "Custom task";
    input.dispatchEvent(keyEvent("Enter"));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(created, ["Custom task"]);
    assert.equal(overlay.classList.contains("hidden"), true);
  } finally {
    globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});

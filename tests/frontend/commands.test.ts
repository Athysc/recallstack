import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../src/features/commands/registry.ts";
import { fuzzyScore, paletteMode, rankCommands } from "../../src/features/commands/ranking.ts";

const state = { workspaceOpen: true, editorOpen: false, nativeDesktop: true };

test("registry rejects duplicate IDs and disabled execution", async () => {
  const registry = new CommandRegistry();
  let calls = 0;
  const command = { id: "file.save", title: "Save", category: "File" as const, isEnabled: () => false, run: () => { calls += 1; } };
  registry.register(command);
  assert.throws(() => registry.register(command), /Duplicate/);
  assert.equal(await registry.execute("file.save", { state, reportError() {} }), false);
  assert.equal(calls, 0);
});

test("non-reentrant commands cannot overlap and errors share one path", async () => {
  const registry = new CommandRegistry();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  registry.register({ id: "tools.wait", title: "Wait", category: "Tools", run: () => waiting });
  const context = { state, reportError() {} };
  const first = registry.execute("tools.wait", context);
  assert.equal(await registry.execute("tools.wait", context), false);
  release();
  assert.equal(await first, true);

  let reported = "";
  registry.register({ id: "tools.fail", title: "Fail", category: "Tools", run: () => { throw new Error("boom"); } });
  assert.equal(await registry.execute("tools.fail", { state, reportError(error) { reported = String(error); } }), false);
  assert.match(reported, /boom/);
});

test("ranking favors exact, prefix, boundary, then fuzzy matches", () => {
  assert.ok(fuzzyScore("save", "Save")! > fuzzyScore("save", "Save Note")!);
  assert.ok(fuzzyScore("note", "Open Note")! > fuzzyScore("note", "Denote")!);
  const commands = [
    { id: "file.save", title: "Save Note", category: "File" as const, run() {} },
    { id: "file.open", title: "Open Note", category: "File" as const, run() {} },
  ];
  assert.equal(rankCommands(commands, "save")[0].command.id, "file.save");
});

test("palette prefixes select explicit modes", () => {
  assert.deepEqual(paletteMode("@daily"), { mode: "notes", query: "daily" });
  assert.deepEqual(paletteMode("#work"), { mode: "tags", query: "work" });
  assert.deepEqual(paletteMode("?keys"), { mode: "help", query: "keys" });
  assert.deepEqual(paletteMode("> save"), { mode: "commands", query: "save" });
});

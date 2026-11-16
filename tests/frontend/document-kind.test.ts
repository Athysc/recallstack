import assert from "node:assert/strict";
import test from "node:test";
import { documentKind, ensureDocumentExtension, isEditableDocumentName, stripDocumentExtension } from "../../src/features/editor/document-kind.ts";
import { normalizeMarkdownFilename } from "../../src/features/notes/new-file.ts";
import { RecallStackSQL } from "../../src/features/editor/sql-dialect.ts";
import { RecallStackPowerShell } from "../../src/features/editor/powershell-language.ts";
import { classHighlighter, highlightTree } from "@lezer/highlight";

test("document kind follows the file extension", () => {
  assert.equal(documentKind("a.sql"), "sql");
  assert.equal(documentKind("A.SQL"), "sql");
  assert.equal(documentKind("a.md"), "markdown");
  assert.equal(isEditableDocumentName("q.sql"), true);
  assert.equal(isEditableDocumentName("q.txt"), false);
});

test("extension helpers keep sql files as sql", () => {
  assert.equal(stripDocumentExtension("report.sql"), "report");
  assert.equal(stripDocumentExtension("note.md"), "note");
  assert.equal(ensureDocumentExtension("report", "folder/report.sql"), "report.sql");
  assert.equal(ensureDocumentExtension("report"), "report.md");
  assert.equal(ensureDocumentExtension("x.sql", "y.md"), "x.sql");
  assert.equal(normalizeMarkdownFilename("migration.SQL"), "migration.sql");
  assert.equal(normalizeMarkdownFilename("note"), "note.md");
});

test("combined dialect covers MSSQL, MySQL and SQLite keywords", () => {
  const keywords = new Set((RecallStackSQL.spec.keywords ?? "").split(/\s+/));
  for (const word of ["nolock", "auto_increment", "autoincrement", "pragma"]) assert.ok(keywords.has(word) || (RecallStackSQL.spec.builtin ?? "").includes(word), word);
});

test("PowerShell scripts, modules and manifests are editable documents", () => {
  for (const name of ["a.ps1", "A.PS1", "m.psm1", "m.psd1"]) {
    assert.equal(documentKind(name), "powershell", name);
    assert.equal(isEditableDocumentName(name), true, name);
  }
  assert.equal(isEditableDocumentName("a.ps1.txt"), false);
  assert.equal(stripDocumentExtension("deploy.ps1"), "deploy");
  assert.equal(ensureDocumentExtension("deploy", "folder/old.psm1"), "deploy.psm1");
  assert.equal(ensureDocumentExtension("deploy.ps1", "x.sql"), "deploy.ps1");
  assert.equal(normalizeMarkdownFilename("Run.PS1"), "Run.ps1");
  assert.equal(normalizeMarkdownFilename("Run.Psm1"), "Run.psm1");
});

test("PowerShell grammar highlights 5.1 and 7 syntax", () => {
  const tokens = (code: string): string[] => {
    const out: string[] = [];
    highlightTree(RecallStackPowerShell.parser.parse(code), classHighlighter, (from, to, cls) => out.push(`${code.slice(from, to)}:${cls}`));
    return out;
  };
  const joined = (code: string) => tokens(code).join(" ");
  assert.match(joined("foreach ($i in 1..3) { }"), /foreach:tok-keyword/);
  assert.match(joined("a && b"), /&&:tok-operator/);
  assert.match(joined("$x ?? 1"), /\?\?:tok-operator/);
  assert.match(joined("$x ??= 1"), /\?\?=:tok-operator/);
  assert.match(joined("$a?.Name"), /\?\.:tok-operator/);
  assert.match(joined("clean { }"), /clean:tok-keyword/);
});

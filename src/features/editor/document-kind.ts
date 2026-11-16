export type DocumentKind = "markdown" | "sql" | "powershell";

/** Windows PowerShell 5.1 and PowerShell 7 share these extensions (script, module, manifest). */
const EDITABLE_EXTENSION = /\.(md|sql|ps1|psm1|psd1)$/i;
const POWERSHELL_EXTENSION = /\.(ps1|psm1|psd1)$/i;

export function documentKind(name: string): DocumentKind {
  if (/\.sql$/i.test(name)) return "sql";
  if (POWERSHELL_EXTENSION.test(name)) return "powershell";
  return "markdown";
}

export function isSqlName(name: string): boolean {
  return documentKind(name) === "sql";
}

export function isPowerShellName(name: string): boolean {
  return documentKind(name) === "powershell";
}

/** Source-code documents (everything editable that is not Markdown). */
export function isCodeName(name: string): boolean {
  return documentKind(name) !== "markdown";
}

/** highlight.js language used to preview a code document as a fenced block. */
export function previewFenceLanguage(name: string): string {
  const kind = documentKind(name);
  return kind === "markdown" ? "" : kind;
}

/** Markdown, SQL or PowerShell — the file types the editor opens and saves as text documents. */
export function isEditableDocumentName(name: string): boolean {
  return EDITABLE_EXTENSION.test(name);
}

/** Drop a trailing editable extension so the remainder can be shown as a title. */
export function stripDocumentExtension(name: string): string {
  return name.replace(EDITABLE_EXTENSION, "");
}

/** The lowercased editable extension of a name (".ps1"), or "" when it has none. */
export function documentExtension(name: string): string {
  return EDITABLE_EXTENSION.exec(name)?.[0].toLowerCase() ?? "";
}

/** Keep an existing editable extension; otherwise append the fallback's (default .md). */
export function ensureDocumentExtension(name: string, fallbackFrom = ""): string {
  if (isEditableDocumentName(name)) return name;
  return `${name}${documentExtension(fallbackFrom) || ".md"}`;
}

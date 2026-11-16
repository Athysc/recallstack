import { MSSQL, MySQL, SQLite, SQLDialect, type SQLDialectSpec } from "@codemirror/lang-sql";

const words = (...lists: (string | undefined)[]): string =>
  [...new Set(lists.flatMap(list => (list ?? "").split(/\s+/)).filter(Boolean))].join(" ");

const dialects = [MSSQL, MySQL, SQLite].map(dialect => dialect.spec);
const field = (key: "keywords" | "types" | "builtin"): string => words(...dialects.map((spec: SQLDialectSpec) => spec[key]));
const chars = (key: "operatorChars" | "identifierQuotes" | "specialVar"): string =>
  [...new Set(dialects.flatMap((spec: SQLDialectSpec) => [...(spec[key] ?? "")]))].join("");

/**
 * One dialect covering T-SQL, MySQL and SQLite together: the union of their
 * keywords/types/builtins, `[bracket]`, "double" and `backtick` identifier
 * quotes, @/:/?/$ variables and # comments. Files carry no dialect marker, so
 * highlighting any of the three correctly beats picking one.
 */
export const RecallStackSQL = SQLDialect.define({
  keywords: field("keywords"),
  types: field("types"),
  builtin: field("builtin"),
  operatorChars: chars("operatorChars"),
  identifierQuotes: chars("identifierQuotes"),
  specialVar: chars("specialVar"),
  charSetCasts: true,
  unquotedBitLiterals: true,
  hashComments: true,
});

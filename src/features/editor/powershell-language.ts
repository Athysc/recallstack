import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";

const WORD_END = /(?=[^A-Za-z\d\-_]|$)/;
const PS7_OPERATORS = /^(?:&&|\|\||\?\?=?|\?\.|\?\[)/;
const PS7_CLEAN_BLOCK = new RegExp(`^clean${WORD_END.source}`, "i");

/**
 * One grammar for Windows PowerShell 5.1 and PowerShell 7. The stock mode covers
 * the 5.1 language; this adds the 7 additions it lacks — pipeline-chain `&&`/`||`,
 * null-coalescing `??`/`??=`, null-conditional `?.`/`?[`, and the `clean` block.
 * Files carry no version marker, so accepting the superset beats picking one.
 */
const parser: StreamParser<unknown> = {
  ...powerShell,
  token(stream, state) {
    if (stream.match(PS7_OPERATORS)) return "operator";
    if (stream.match(PS7_CLEAN_BLOCK)) return "keyword";
    return powerShell.token(stream as never, state as never);
  },
};

export const RecallStackPowerShell = StreamLanguage.define(parser);

import type { AppCommand } from "./registry";

export interface RankedCommand { command: AppCommand; score: number }

function normalize(value: string): string { return value.trim().toLocaleLowerCase(); }

export function fuzzyScore(query: string, candidate: string): number | null {
  const needle = normalize(query);
  const haystack = normalize(candidate);
  if (!needle) return 0;
  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 800 - haystack.length;
  const boundary = haystack.search(new RegExp(`(?:^|[\\s/._-])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  if (boundary >= 0) return 650 - boundary;
  const substring = haystack.indexOf(needle);
  if (substring >= 0) return 500 - substring;
  let cursor = 0;
  let gaps = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return null;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return 250 - gaps;
}

export function rankCommands(commands: AppCommand[], query: string, usage: Record<string, number> = {}): RankedCommand[] {
  return commands.flatMap(command => {
    const fields = [command.title, command.category, ...(command.keywords || [])];
    const scores = fields.map(field => fuzzyScore(query, field)).filter((score): score is number => score !== null);
    if (!scores.length) return [];
    return [{ command, score: Math.max(...scores) + Math.min(50, usage[command.id] || 0) }];
  }).sort((left, right) => right.score - left.score || left.command.title.localeCompare(right.command.title));
}

export function paletteMode(query: string): { mode: "commands" | "notes" | "tags" | "help"; query: string } {
  const prefix = query[0];
  const mode = prefix === "@" ? "notes" : prefix === "#" ? "tags" : prefix === "?" ? "help" : "commands";
  return { mode, query: prefix === ">" || prefix === "@" || prefix === "#" || prefix === "?" ? query.slice(1).trimStart() : query };
}

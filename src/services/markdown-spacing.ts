const FENCE = /^\s*(`{3,}|~{3,})/;

/** Preserve blank lines beyond Markdown's normal single block separator. */
export function preserveExtraBlankLines(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let fenceMarker: "`" | "~" | null = null;

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1][0] as "`" | "~";
      if (fenceMarker === null) fenceMarker = marker;
      else if (fenceMarker === marker) fenceMarker = null;
      output.push(line);
      index += 1;
      continue;
    }

    if (fenceMarker === null && /^\s*$/.test(line)) {
      let end = index + 1;
      while (end < lines.length && /^\s*$/.test(lines[end])) end += 1;
      const count = end - index;
      output.push("");
      if (count > 1 && index > 0 && end < lines.length) {
        output.push(`<div class="md-extra-blank-lines" aria-hidden="true">${"<span></span>".repeat(count - 1)}</div>`, "");
      } else {
        for (let extra = 1; extra < count; extra += 1) output.push("");
      }
      index = end;
      continue;
    }

    output.push(line);
    index += 1;
  }

  return output.join("\n");
}

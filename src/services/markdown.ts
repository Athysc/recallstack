import { marked } from "marked";

marked.use({ breaks: true, gfm: true });

export function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string;
}

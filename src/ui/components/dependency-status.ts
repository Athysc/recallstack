export type DependencyState = "loaded" | "missing" | "loading" | "lazy" | "disabled";
export type DependencySource = "local" | "native" | "unknown";

export interface DependencyStatus {
  label: string;
  state: DependencyState;
  source: DependencySource;
  detail: string;
  errorText: string;
}

export type DependencyKey = "marked" | "hljs" | "hljsFull" | "mermaid" | "sql";

const STATE_LABEL: Record<DependencyState, string> = {
  loaded: "Loaded and ready",
  missing: "Not loaded",
  loading: "Loading",
  lazy: "Lazy loaded when needed",
  disabled: "Disabled",
};

export class DependencyStatusController {
  private readonly statuses: Record<DependencyKey, DependencyStatus>;
  private readonly list: HTMLElement;
  private readonly errorLine: HTMLElement;

  constructor(
    list: HTMLElement,
    errorLine: HTMLElement,
    sources: Partial<Record<DependencyKey, string>>,
  ) {
    this.list = list;
    this.errorLine = errorLine;
    const source = (key: DependencyKey): DependencySource => {
      const value = sources[key];
      return value === "local" || value === "native" ? value : "unknown";
    };
    this.statuses = {
      marked: { label: "Markdown", state: "loading", source: source("marked"), detail: "marked.js renderer", errorText: "" },
      hljs: { label: "Syntax", state: "loading", source: source("hljs"), detail: "highlight.js core", errorText: "" },
      hljsFull: { label: "Syntax+", state: "lazy", source: "local", detail: "Extra syntax bundle loads only when needed", errorText: "" },
      mermaid: { label: "Mermaid", state: "lazy", source: source("mermaid"), detail: "Mermaid diagrams", errorText: "" },
      sql: { label: "SQLite", state: "loaded", source: "native", detail: "Native SQLite index", errorText: "" },
    };
  }

  set(key: DependencyKey, patch: Partial<Omit<DependencyStatus, "label">>): void {
    Object.assign(this.statuses[key], patch);
    this.render();
  }

  render(): void {
    this.list.innerHTML = Object.entries(this.statuses).map(([key, dependency]) => {
      const title = `${dependency.label}: ${STATE_LABEL[dependency.state]} • Source: ${dependency.source}${dependency.detail ? ` • ${dependency.detail}` : ""}${dependency.errorText ? ` • ${dependency.errorText}` : ""}`;
      return `<span class="dep-chip" data-dep="${escapeAttribute(key)}" data-state="${dependency.state}" data-source="${dependency.source}" title="${escapeAttribute(title)}">
        <span class="dep-state-dot" aria-hidden="true"></span>
        <span class="dep-chip-name">${escapeAttribute(dependency.label)}</span>
        <span class="dep-source-text">(${dependency.source})</span>
      </span>`;
    }).join("");
    const errors = Object.values(this.statuses).map(dependency => dependency.errorText).filter(Boolean).join(" • ");
    this.errorLine.textContent = errors;
    this.errorLine.title = errors;
  }
}

function escapeAttribute(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

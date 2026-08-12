import { parseDateLocal, type TaskMetadata } from "./metadata.ts";

export function setChoiceSelection(container: HTMLElement, kind: string, value: string): void {
  container.querySelectorAll<HTMLElement>(`[data-${kind}]`).forEach(button => {
    const selected = button.dataset[kind] === value;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

export function taskMetaSummaryHtml(
  meta: TaskMetadata,
  normalizePriority: (value: string | null) => string,
  priorityLabel: (value: string) => string,
  escape: (value: string) => string,
): string {
  const format = (value: string | null) => parseDateLocal(value)
    ? `${+value!.slice(5, 7)}/${+value!.slice(8, 10)}/${value!.slice(0, 4)}`
    : "NA";
  const item = (label: string, value: string, className: string) =>
    `<span class="${value === "NA" ? "na" : className}">${label}: ${value}</span>`;
  const priority = normalizePriority(meta.priority || "Normal");
  return `${item("S", format(meta.startDate), "start")} ${item("C", format(meta.completedDate), "completed")} ${item("Due", format(meta.dueDate), "due")} <span class="priority-${priority}">P: ${escape(priorityLabel(priority).replace(" Priority", ""))}</span>`;
}

export function taskKindIndicatorMarkup(working: boolean, journal = false): string {
  if (journal) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2z"/><path d="M5 4v16a2 2 0 0 1 2-2h12M9 8h6M9 12h6"/></svg><span>JOURNAL</span>';
  return working
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16v12H4z"/><path d="M9 7V5h6v2M4 12h16M10 12v2h4v-2"/></svg><span>WORKING</span>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 2.5 2.5L16 9"/></svg><span>TASK</span>';
}

export function syncDateInputBorders(inputs: HTMLInputElement[]): void {
  inputs.forEach(input => input.classList.toggle("has-value", Boolean(input.value)));
}

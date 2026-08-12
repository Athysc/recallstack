import type { NamedDirectory } from "../../services/filesystem";

export type NavRowMode = "buttons" | "combo";

export function createNavButton(label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "nav-btn";
  button.textContent = label;
  button.dataset.navKey = label;
  button.addEventListener("click", () => void onClick());
  return button;
}

export function createNavCombo(
  row: 1 | 2,
  folders: NamedDirectory[],
  activeName: string | null,
  onSelect: (folder: NamedDirectory) => void | Promise<void>,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "nav-combo";
  select.id = `nav${row}-combo`;
  if (row === 1) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— select folder —";
    placeholder.disabled = true;
    select.appendChild(placeholder);
  }
  folders.forEach(folder => {
    const option = document.createElement("option");
    option.value = folder.name;
    option.textContent = folder.name;
    select.appendChild(option);
  });
  select.value = activeName && folders.some(folder => folder.name === activeName)
    ? activeName
    : row === 2 ? folders[0]?.name || "" : "";
  select.addEventListener("change", () => {
    const selected = folders.find(folder => folder.name === select.value);
    if (selected) void onSelect(selected);
  });
  return select;
}

export function createNavSeparator(): HTMLDivElement {
  const separator = document.createElement("div");
  separator.className = "nav-separator";
  return separator;
}

export function setActiveNavigation(row: HTMLElement, name: string): void {
  row.querySelectorAll<HTMLElement>(".nav-btn").forEach(button => {
    button.classList.toggle("active", (button.dataset.navKey || button.textContent) === name);
  });
  const combo = row.querySelector<HTMLSelectElement>(".nav-combo");
  if (combo && Array.from(combo.options).some(option => option.value === name)) combo.value = name;
}

export function syncNavModeButtons(
  row1Button: HTMLElement | null,
  row2Button: HTMLElement | null,
  row1Mode: NavRowMode,
  row2Mode: NavRowMode,
): void {
  for (const [button, active] of [[row1Button, row1Mode === "combo"], [row2Button, row2Mode === "combo"]] as const) {
    if (!button) continue;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

export function createArchiveToggle(
  archive: boolean,
  hidden: boolean,
  icons: { archive: string; folder: string },
  onToggle: () => void | Promise<void>,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = "btn-archive-mode";
  button.className = "nav-archive-toggle";
  button.classList.toggle("hidden", hidden);
  button.classList.toggle("active", archive);
  button.title = archive ? "Show current folder" : "Show archived files";
  button.innerHTML = archive ? icons.folder : icons.archive;
  button.addEventListener("click", () => void onToggle());
  return button;
}

import type { AppView } from "../navigation/view-state";

export interface EditorViewElements {
  welcome: HTMLElement;
  app: HTMLElement;
  fileList: HTMLElement;
  search: HTMLElement;
  editor: HTMLElement;
  calendar: HTMLElement;
  taskCountBar: HTMLElement;
}

export function renderAppView(elements: EditorViewElements, view: AppView): void {
  elements.welcome.classList.toggle("hidden", view !== "welcome");
  elements.app.classList.toggle("hidden", view === "welcome");
  elements.fileList.classList.toggle("hidden", view !== "list");
  elements.search.classList.toggle("hidden", view !== "search");
  elements.editor.classList.toggle("hidden", view !== "editor");
  elements.calendar.classList.toggle("hidden", view !== "calendar");
  elements.taskCountBar.classList.add("hidden");
  elements.taskCountBar.replaceChildren();
}

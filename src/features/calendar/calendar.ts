export type CalendarTaskType = "due" | "start" | "completed";

export interface CalendarIndexEntry {
  notesRelPath: string;
  name: string;
  content: string;
}

export interface CalendarTask {
  name: string;
  notesRelPath: string;
  dueDate?: string | null;
  startDate?: string | null;
  completedDate?: string | null;
  priority?: string | null;
  type: CalendarTaskType;
}

export interface CalendarTaskMetadata {
  dueDate?: string | null;
  startDate?: string | null;
  completedDate?: string | null;
  priority?: string | null;
}

export interface CalendarFilters {
  due: boolean;
  started: boolean;
  completed: boolean;
}

export interface CalendarCell {
  date: string;
  year: number;
  month: number;
  day: number;
  otherMonth: boolean;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const pad = (value: number) => String(value).padStart(2, "0");

export function localDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function buildCalendarTaskMap(
  entries: readonly CalendarIndexEntry[],
  metadataFor: (name: string, content: string) => CalendarTaskMetadata,
  validDate: (value: string) => unknown,
): Map<string, CalendarTask[]> {
  const taskMap = new Map<string, CalendarTask[]>();
  for (const entry of entries) {
    const parts = entry.notesRelPath.split("/");
    if (parts[0] !== "tasks" || parts[1] === "archived") continue;
    const metadata = metadataFor(entry.name, entry.content);
    const add = (date: string | null | undefined, type: CalendarTaskType) => {
      if (!date || !validDate(date)) return;
      const key = date.slice(0, 10);
      const tasks = taskMap.get(key) ?? [];
      if (!tasks.some(task => task.notesRelPath === entry.notesRelPath && task.type === type)) {
        tasks.push({ name: entry.name, notesRelPath: entry.notesRelPath, ...metadata, type });
        taskMap.set(key, tasks);
      }
    };
    add(metadata.dueDate, "due");
    add(metadata.startDate, "start");
    add(metadata.completedDate, "completed");
  }
  return taskMap;
}

export function filteredCalendarTasks(
  taskMap: ReadonlyMap<string, CalendarTask[]>,
  date: string,
  filters: CalendarFilters,
): CalendarTask[] {
  return (taskMap.get(date) ?? []).filter(task =>
    (task.type === "due" && filters.due)
    || (task.type === "start" && filters.started)
    || (task.type === "completed" && filters.completed));
}

export function monthCells(year: number, month: number): CalendarCell[] {
  const firstDay = new Date(year, month, 1).getDay();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, month, index - firstDay + 1);
    return {
      date: localDateKey(date.getFullYear(), date.getMonth(), date.getDate()),
      year: date.getFullYear(), month: date.getMonth(), day: date.getDate(),
      otherMonth: date.getMonth() !== month,
    };
  });
}

export function weekCells(anchorDate: Date): CalendarCell[] {
  const sunday = new Date(anchorDate);
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + index);
    return {
      date: localDateKey(date.getFullYear(), date.getMonth(), date.getDate()),
      year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), otherMonth: false,
    };
  });
}

export function calendarHeading(mode: "month" | "week", year: number, month: number, anchor: Date): string {
  if (mode === "month") return `${MONTHS[month]} ${year}`;
  const cells = weekCells(anchor);
  const first = cells[0];
  const last = cells[6];
  return `${MONTHS[first.month].slice(0, 3)} ${first.day} – ${MONTHS[last.month].slice(0, 3)} ${last.day}, ${last.year}`;
}

export function calendarDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

export interface RenderCalendarOptions {
  heading: HTMLElement;
  grid: HTMLElement;
  panel: HTMLElement | null;
  mode: "month" | "week";
  year: number;
  month: number;
  weekAnchor: Date;
  selectedDate: string | null;
  today?: Date;
  tasksFor(date: string): CalendarTask[];
  taskTitle(name: string): string;
  escape(value: string): string;
  onSelect(date: string): void;
  onOpen(task: CalendarTask, event: MouseEvent): void;
  onOpenJournal(date: string, event: MouseEvent): void;
}

export function renderCalendar(options: RenderCalendarOptions): void {
  const { heading, grid } = options;
  const cells = options.mode === "week" ? weekCells(options.weekAnchor) : monthCells(options.year, options.month);
  heading.textContent = calendarHeading(options.mode, options.year, options.month, options.weekAnchor);
  grid.classList.toggle("week-view", options.mode === "week");
  grid.replaceChildren();
  const today = options.today ?? new Date();
  const todayKey = localDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const dotClass: Record<CalendarTaskType, string> = { due: "cal-dot-due", start: "cal-dot-start", completed: "cal-dot-completed" };
  const dotLabel: Record<CalendarTaskType, string> = { due: "Due: ", start: "Start: ", completed: "Done: " };

  cells.forEach(cellData => {
    const cell = document.createElement("div");
    cell.className = "cal-day";
    cell.classList.toggle("other-month", cellData.otherMonth);
    cell.classList.toggle("today", cellData.date === todayKey);
    cell.classList.toggle("selected", cellData.date === options.selectedDate);
    cell.dataset.date = cellData.date;
    const number = document.createElement("div");
    number.className = "cal-day-num";
    number.textContent = String(cellData.day);
    cell.appendChild(number);
    const tasks = options.tasksFor(cellData.date);
    if (tasks.length) {
      const dots = document.createElement("div");
      dots.className = "cal-dots";
      const limit = options.mode === "week" ? tasks.length : 3;
      tasks.slice(0, limit).forEach(task => {
        const dot = document.createElement("div");
        dot.className = `cal-dot ${dotClass[task.type]}`;
        dot.textContent = options.taskTitle(task.name);
        dot.title = dotLabel[task.type] + options.taskTitle(task.name);
        dots.appendChild(dot);
      });
      if (options.mode === "month" && tasks.length > limit) {
        const more = document.createElement("div");
        more.className = "cal-dot cal-dot-more";
        more.textContent = `+${tasks.length - limit} more`;
        dots.appendChild(more);
      }
      cell.appendChild(dots);
    }
    cell.addEventListener("click", () => options.onSelect(cellData.date));
    grid.appendChild(cell);
  });
  if (options.selectedDate) renderCalendarTaskPanel(options, options.selectedDate);
}

export function renderCalendarTaskPanel(options: RenderCalendarOptions, date: string): void {
  if (!options.panel) return;
  const tasks = options.tasksFor(date);
  options.panel.classList.remove("hidden");
  const label = calendarDateLabel(date);
  options.panel.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "cal-panel-heading";
  heading.textContent = tasks.length ? `${label} — ${tasks.length} task${tasks.length !== 1 ? "s" : ""}` : label;
  const journal = document.createElement("button");
  journal.type = "button";
  journal.className = "cal-task-card cal-journal-card";
  journal.setAttribute("aria-label", `Open Journal / Daily Log for ${label}`);
  const journalIcon = document.createElement("span");
  journalIcon.className = "file-icon";
  journalIcon.textContent = "☀";
  const journalName = document.createElement("span");
  journalName.className = "cal-task-name";
  journalName.textContent = "Journal / Daily Log";
  const journalMeta = document.createElement("span");
  journalMeta.className = "cal-task-meta";
  journalMeta.textContent = "Open daily entry";
  journal.append(journalIcon, journalName, journalMeta);
  journal.addEventListener("click", event => options.onOpenJournal(date, event));
  options.panel.append(heading, journal);
  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "cal-empty-day";
    empty.textContent = "No tasks on this day.";
    options.panel.appendChild(empty);
    return;
  }
  tasks.forEach(task => {
    const card = document.createElement("div");
    card.className = "cal-task-card";
    const meta = task.type === "due" ? `Due: ${task.dueDate || date}`
      : task.type === "start" ? `Start: ${task.startDate || date}` : `Done: ${task.completedDate || date}`;
    const metaClass = task.type === "due" ? "due" : task.type === "completed" ? "completed" : "start";
    card.innerHTML = `<span class="file-icon">&#x1F4C4;</span><span class="cal-task-name">${options.escape(options.taskTitle(task.name))}</span><span class="cal-task-meta ${metaClass}">${options.escape(meta)}</span>`;
    card.addEventListener("click", event => options.onOpen(task, event));
    options.panel!.appendChild(card);
  });
}

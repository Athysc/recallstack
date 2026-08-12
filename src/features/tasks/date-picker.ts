export interface CalendarDay {
  day: number;
  iso: string;
}

export function localIsoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function calendarMonth(year: number, month: number): Array<CalendarDay | null> {
  const leading = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const cells: Array<CalendarDay | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= count; day += 1) {
    cells.push({ day, iso: localIsoDate(new Date(year, month, day)) });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

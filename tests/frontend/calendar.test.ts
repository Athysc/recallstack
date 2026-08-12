import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarTaskMap, calendarDateLabel, calendarHeading, filteredCalendarTasks, monthCells, weekCells } from "../../src/features/calendar/calendar.ts";

test("calendar task map indexes valid workspace-level task dates and honors filters", () => {
  const map = buildCalendarTaskMap([
    { notesRelPath: "tasks/Ship.md", name: "Ship.md", content: "dates" },
    { notesRelPath: "project/notes/Ignore.md", name: "Ignore.md", content: "dates" },
  ], () => ({ startDate: "2026-08-01", dueDate: "2026-08-10", completedDate: "bad" }), value => /^\d{4}-\d{2}-\d{2}$/.test(value));
  assert.deepEqual([...map.keys()], ["2026-08-10", "2026-08-01"]);
  assert.equal(filteredCalendarTasks(map, "2026-08-10", { due: true, started: false, completed: false })[0].type, "due");
  assert.deepEqual(filteredCalendarTasks(map, "2026-08-10", { due: false, started: true, completed: true }), []);
});

test("calendar month and week cells preserve Sunday-first layout", () => {
  const august = monthCells(2026, 7);
  assert.equal(august.length, 42);
  assert.deepEqual(august[0], { date: "2026-07-26", year: 2026, month: 6, day: 26, otherMonth: true });
  assert.equal(august[6].date, "2026-08-01");
  const week = weekCells(new Date(2026, 7, 10, 12));
  assert.equal(week[0].date, "2026-08-09");
  assert.equal(week[6].date, "2026-08-15");
  assert.equal(calendarHeading("week", 2026, 7, new Date(2026, 7, 10)), "Aug 9 – Aug 15, 2026");
  assert.equal(calendarDateLabel("2026-08-10"), "August 10, 2026");
});

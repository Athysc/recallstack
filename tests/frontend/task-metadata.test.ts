import assert from "node:assert/strict";
import test from "node:test";
import {
  TASK_HEADER,
  hasStandardTaskHeader,
  makeTaskContent,
  parseDateLocal,
  parseTaskDates,
  removeLegacyTaskHeader,
  taskMetaFor,
} from "../../src/features/tasks/metadata.ts";
import { taskKindIndicatorMarkup, taskMetaSummaryHtml } from "../../src/features/tasks/date-bar.ts";

test("task headers are added, recognized, de-duplicated, and removed", () => {
  const body = "# Task\n\nBody";
  assert.equal(makeTaskContent(body), TASK_HEADER + body);
  assert.equal(hasStandardTaskHeader(TASK_HEADER + body), true);
  assert.equal(makeTaskContent(TASK_HEADER + TASK_HEADER + body), TASK_HEADER + body);
  assert.equal(removeLegacyTaskHeader(TASK_HEADER + body), body);
});

test("task metadata ignores fenced examples and falls back from filenames", () => {
  const content = "Priority: **High**\nStart Date: 2026-08-10\n```\nDue Date: 1999-01-01\n```\nDue Date: 2026-08-12";
  assert.deepEqual(parseTaskDates(content), { priority: "High", startDate: "2026-08-10", completedDate: null, dueDate: "2026-08-12" });
  assert.equal(taskMetaFor("Plain.md", content).title, "Plain");
  assert.equal(parseDateLocal("2026-08-10")?.getDate(), 10);
  assert.equal(parseDateLocal("invalid"), null);
});

test("task date-bar presentation is derived from typed metadata", () => {
  const html = taskMetaSummaryHtml(
    { priority: "high", startDate: "2026-08-10", completedDate: null, dueDate: "2026-08-12" },
    value => value || "normal",
    value => `${value} Priority`,
    value => value,
  );
  assert.match(html, /S: 8\/10\/2026/);
  assert.match(html, /C: NA/);
  assert.match(html, /priority-high/);
  assert.match(taskKindIndicatorMarkup(true), /WORKING/);
  assert.match(taskKindIndicatorMarkup(false, true), /JOURNAL/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { calendarMonth, localIsoDate } from "../../src/features/tasks/date-picker.ts";

test("custom date picker generates stable local ISO dates", () => {
  assert.equal(localIsoDate(new Date(2026, 7, 6)), "2026-08-06");
});

test("custom date picker includes leading cells and every day", () => {
  const august = calendarMonth(2026, 7);
  assert.equal(august.length, 42);
  assert.equal(august.filter(Boolean).length, 31);
  assert.equal(august.find(Boolean)?.iso, "2026-08-01");
  assert.equal(august.filter(Boolean).at(-1)?.iso, "2026-08-31");
});

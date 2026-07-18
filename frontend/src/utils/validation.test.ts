import { describe, expect, it } from "vitest";

import type { TimesheetRow } from "@/types/timesheet";
import {
  buildWarnings,
  hasBlockingError,
  regularWorkdayCapacity,
  regularWorkdayLimit,
} from "@/utils/validation";

const fullWeek = [
  "2026-07-20",
  "2026-07-21",
  "2026-07-22",
  "2026-07-23",
  "2026-07-24",
  "2026-07-25",
  "2026-07-26",
];

function rowWithFullDays(days: string[]): TimesheetRow {
  return {
    projectId: 1,
    percents: Object.fromEntries(days.map((day) => [day, 100])),
    descriptions: {},
  };
}

describe("regular timesheet workday limits", () => {
  it("allows the seventh regular workday on Sunday", () => {
    const rows = [rowWithFullDays(fullWeek)];

    expect(regularWorkdayCapacity(fullWeek)).toBe(6);
    expect(regularWorkdayLimit(fullWeek)).toBe(7);
    expect(hasBlockingError(rows, fullWeek)).toBe(false);
    expect(buildWarnings(rows, {}, fullWeek)).not.toContainEqual(
      expect.objectContaining({ type: "error" }),
    );
  });

  it("still blocks a daily total above one workday", () => {
    const rows = [
      rowWithFullDays(fullWeek),
      {
        projectId: 2,
        percents: { [fullWeek[0]]: 1 },
        descriptions: {},
      } satisfies TimesheetRow,
    ];

    expect(hasBlockingError(rows, fullWeek)).toBe(true);
  });
});

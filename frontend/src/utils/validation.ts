import type { TimesheetRow, OvertimeStore } from "@/types/timesheet";

export const FULL_ATTENDANCE_WEEK_WORKDAYS = 6;
export const MAX_REGULAR_WEEK_WORKDAYS = 7;
export const MAX_DAILY_PERCENT = 100;
const EPSILON = 0.0001;

export interface Warning {
  text: string;
  type: "error" | "warning" | "info";
}

export function formatWorkdays(value: number): string {
  const roundedToOne = Number(value.toFixed(1));
  return Math.abs(value - roundedToOne) > EPSILON
    ? value.toFixed(2)
    : value.toFixed(1);
}

export function dayPercent(
  rows: TimesheetRow[],
  day: string,
): number {
  return rows.reduce((sum, r) => sum + (r.percents[day] || 0), 0);
}

export function rowPercent(
  row: TimesheetRow,
  days: string[],
): number {
  return days.reduce((sum, d) => sum + (row.percents[d] || 0), 0);
}

export function weekWorkdays(
  rows: TimesheetRow[],
  days: string[],
): number {
  return days.reduce((sum, d) => dayPercent(rows, d) / 100 + sum, 0);
}

export function weekOvertime(
  overtime: Record<string, OvertimeStore>,
  days: string[],
): number {
  return days.reduce((sum, d) => sum + (overtime[d]?.hours || 0), 0);
}

export function hasBlockingError(
  rows: TimesheetRow[],
  days: string[],
): boolean {
  return (
    days.some((d) => dayPercent(rows, d) > MAX_DAILY_PERCENT) ||
    weekWorkdays(rows, days) > MAX_REGULAR_WEEK_WORKDAYS + EPSILON
  );
}

export function buildWarnings(
  rows: TimesheetRow[],
  overtime: Record<string, OvertimeStore>,
  days: string[],
): Warning[] {
  const warnings: Warning[] = [];
  let hasOvertime = false;
  let hasRejectedOvertime = false;

  for (const day of days) {
    const pct = dayPercent(rows, day);
    if (pct > MAX_DAILY_PERCENT) {
      warnings.push({ text: `${day} 合计 ${pct}%，超过 100%`, type: "error" });
    } else if (pct < MAX_DAILY_PERCENT && pct > 0) {
      warnings.push({
        text: `${day} 合计 ${pct}%，未达到 100%`,
        type: "warning",
      });
    }

    const ot = overtime[day];
    if (ot?.hours > 0) {
      hasOvertime = true;
      if (ot.status === "rejected") {
        hasRejectedOvertime = true;
      }
    }
  }

  const workdays = weekWorkdays(rows, days);
  if (workdays > MAX_REGULAR_WEEK_WORKDAYS + EPSILON) {
    warnings.push({
      text: `本周普通工日合计 ${formatWorkdays(workdays)}，超过 ${MAX_REGULAR_WEEK_WORKDAYS.toFixed(1)} 工日`,
      type: "error",
    });
  } else if (workdays < FULL_ATTENDANCE_WEEK_WORKDAYS && rows.length > 0) {
    warnings.push({
      text: `本周合计 ${formatWorkdays(workdays)} 工日，未满勤 ${FULL_ATTENDANCE_WEEK_WORKDAYS} 工日`,
      type: "warning",
    });
  }

  if (hasOvertime) {
    warnings.push({ text: "本周有加班记录", type: "info" });
  }

  if (hasRejectedOvertime) {
    warnings.push({
      text: "有加班记录被退回，请查看并修改",
      type: "error",
    });
  }

  if (warnings.length === 0) {
    warnings.push({ text: "本周所有工作日均完成填写且校验通过", type: "info" });
  }

  return warnings;
}

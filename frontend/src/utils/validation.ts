import type { TimesheetRow, OvertimeStore } from "@/types/timesheet";

export interface Warning {
  text: string;
  type: "error" | "warning" | "info";
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
  return days.reduce((sum, d) => Math.min(dayPercent(rows, d), 100) / 100 + sum, 0);
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
  return days.some((d) => dayPercent(rows, d) > 100);
}

export function buildWarnings(
  rows: TimesheetRow[],
  overtime: Record<string, OvertimeStore>,
  days: string[],
): Warning[] {
  const warnings: Warning[] = [];
  let hasUnfilled = false;
  let hasOvertime = false;
  let hasRejectedOvertime = false;

  for (const day of days) {
    const pct = dayPercent(rows, day);
    if (pct > 100) {
      warnings.push({ text: `${day} 合计 ${pct}%，超过 100%`, type: "error" });
    } else if (pct < 100 && pct > 0) {
      warnings.push({
        text: `${day} 合计 ${pct}%，未达到 100%`,
        type: "warning",
      });
      hasUnfilled = true;
    } else if (pct === 0) {
      hasUnfilled = true;
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
  if (workdays < 6 && rows.length > 0) {
    warnings.push({
      text: `本周合计 ${workdays.toFixed(1)} 工日，未满勤 6 工日`,
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

  // Check for missing descriptions
  const missingDescs = rows.filter(
    (r) =>
      r.projectId &&
      days.some(
        (d) => (r.percents[d] || 0) > 0 && !r.descriptions[d]?.trim(),
      ),
  );
  if (missingDescs.length > 0) {
    warnings.push({
      text: `项目 "${missingDescs[0].projectId}" 有工日缺少备注说明`,
      type: "warning",
    });
  }

  if (warnings.length === 0) {
    warnings.push({ text: "本周所有工作日均完成填写且校验通过", type: "info" });
  }

  return warnings;
}

import { addDaysToIso, isoDate, mondayOfWeek } from "@/utils/dates";

export type PeriodType = "week" | "month" | "quarter" | "year";

export interface PeriodDates {
  startDate: string;
  endDate: string;
}

export function computePeriodDates(
  type: PeriodType,
  year: number,
  month: number,
  quarter: number,
  weekStart?: string,
): PeriodDates {
  if (type === "week") {
    const start = mondayOfWeek(weekStart || isoDate(new Date()));
    return { startDate: start, endDate: addDaysToIso(start, 6) };
  }
  if (type === "month") {
    const m = String(month).padStart(2, "0");
    const start = `${year}-${m}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;
    return { startDate: start, endDate: end };
  }
  if (type === "quarter") {
    const qStartMonth = (quarter - 1) * 3 + 1;
    const qEndMonth = quarter * 3;
    const start = `${year}-${String(qStartMonth).padStart(2, "0")}-01`;
    const lastDay = new Date(year, qEndMonth, 0).getDate();
    const end = `${year}-${String(qEndMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return { startDate: start, endDate: end };
  }
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

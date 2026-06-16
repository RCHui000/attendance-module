import { format, addDays, startOfWeek, differenceInMonths } from "date-fns";

/** Format a Date as YYYY-MM-DD string */
export function isoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Parse YYYY-MM-DD string into a local Date */
export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Get the Monday of the week containing the given date string */
export function mondayOfWeek(value: string): string {
  const date = parseLocalDate(value);
  const monday = startOfWeek(date, { weekStartsOn: 1 });
  return isoDate(monday);
}

/** Add N days to a YYYY-MM-DD string */
export function addDaysToIso(value: string, days: number): string {
  const date = parseLocalDate(value);
  return isoDate(addDays(date, days));
}

/** Get an array of 7 day strings starting from Monday */
export function getWeekDays(mondayStr: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToIso(mondayStr, i));
}

/** Get the first day of the month containing the given date string */
export function firstDayOfMonth(value: string): string {
  const date = parseLocalDate(value);
  return isoDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

/** Get the last day of the month containing the given date string */
export function lastDayOfMonth(value: string): string {
  const date = parseLocalDate(value);
  return isoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

/** Get the month-clipped timesheet period start containing the given date */
export function timesheetPeriodStartOfDate(value: string): string {
  const weekStart = mondayOfWeek(value);
  const monthStart = firstDayOfMonth(value);
  return weekStart < monthStart ? monthStart : weekStart;
}

/** Get the month-clipped timesheet period end for a period start */
export function getTimesheetPeriodEnd(periodStart: string): string {
  const weekEnd = addDaysToIso(mondayOfWeek(periodStart), 6);
  const monthEnd = lastDayOfMonth(periodStart);
  return weekEnd < monthEnd ? weekEnd : monthEnd;
}

/** Get day strings for a timesheet period, clipped at natural month boundaries */
export function getTimesheetPeriodDays(periodStart: string): string[] {
  const end = getTimesheetPeriodEnd(periodStart);
  const days: string[] = [];
  for (let day = periodStart; day <= end; day = addDaysToIso(day, 1)) {
    days.push(day);
  }
  return days;
}

/** Get the fixed Monday-Sunday display days for a timesheet period */
export function getTimesheetDisplayWeekDays(periodStart: string): string[] {
  return getWeekDays(mondayOfWeek(periodStart));
}

/** Get the previous month-clipped timesheet period start */
export function previousTimesheetPeriodStart(periodStart: string): string {
  return timesheetPeriodStartOfDate(addDaysToIso(periodStart, -1));
}

/** Get the next month-clipped timesheet period start */
export function nextTimesheetPeriodStart(periodStart: string): string {
  return timesheetPeriodStartOfDate(addDaysToIso(getTimesheetPeriodEnd(periodStart), 1));
}

/** Compute months between two date strings for contract duration */
export function monthsBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  return differenceInMonths(parseLocalDate(end), parseLocalDate(start));
}

/** Format a number as Chinese Yuan */
export function formatMoney(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  return num.toLocaleString("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";
import type { ReportData } from "@/types/project";

interface MonthSlot {
  startDate: string;
  endDate: string;
  label: string;
}

interface MonthlyProjectRow {
  month: string;
  [projectCode: string]: number | string;
}

interface MonthlyData {
  projectCodes: string[];
  months: string[];
  rows: MonthlyProjectRow[];
}

/**
 * Generate last N month slots ending at the given reference date.
 */
export function lastNMonths(
  n: number,
  refYear: number,
  refMonth: number,
): MonthSlot[] {
  const slots: MonthSlot[] = [];
  let y = refYear;
  let m = refMonth;
  for (let i = 0; i < n; i++) {
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    slots.unshift({ startDate: start, endDate: end, label: `${m}月` });
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return slots;
}

export function useMonthlyData(
  months: MonthSlot[],
  enabled = true,
) {
  const queries = useQueries({
    queries: months.map((slot) => ({
      queryKey: ["reports", "monthly", slot.startDate, slot.endDate],
      queryFn: () =>
        api<ReportData>(
          `/api/reports/weekly?startDate=${slot.startDate}&endDate=${slot.endDate}`,
        ),
      enabled,
    })),
  });

  const monthlyData: MonthlyData | null = useMemo(() => {
    if (queries.some((q) => q.isLoading || q.isError || !q.data)) {
      return null;
    }

    // Collect all unique project codes
    const codeSet = new Set<string>();
    const allData = queries.map((q) => q.data!);

    for (const report of allData) {
      for (const p of report.projects || []) {
        if (p.code) codeSet.add(p.code);
      }
    }

    const projectCodes = Array.from(codeSet).sort();
    const monthLabels = months.map((m) => m.label);

    // Build rows: one per project
    const rows: MonthlyProjectRow[] = projectCodes.map((code) => {
      const row: MonthlyProjectRow = { month: code };
      for (let i = 0; i < months.length; i++) {
        const report = allData[i];
        const proj = report.projects?.find((p) => p.code === code);
        row[monthLabels[i]] = proj?.total_hours ?? 0;
      }
      return row;
    });

    return { projectCodes, months: monthLabels, rows };
  }, [queries, months]);

  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);

  return { monthlyData, isLoading, isError };
}

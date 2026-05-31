import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type PeriodType = "month" | "quarter" | "year";

export interface PeriodDates {
  startDate: string;
  endDate: string;
}

export function computePeriodDates(
  type: PeriodType,
  year: number,
  month: number,
  quarter: number,
): PeriodDates {
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
  // year
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

interface PeriodFilterProps {
  periodType: PeriodType;
  year: number;
  month: number;
  quarter: number;
  onPeriodTypeChange: (type: PeriodType) => void;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number) => void;
  onQuarterChange: (quarter: number) => void;
}

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: "month", label: "月" },
  { value: "quarter", label: "季" },
  { value: "year", label: "年" },
];

export function PeriodFilter({
  periodType,
  year,
  month,
  quarter,
  onPeriodTypeChange,
  onYearChange,
  onMonthChange,
  onQuarterChange,
}: PeriodFilterProps) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <div className="flex items-center gap-2">
      {/* Period type buttons — plain buttons to avoid @base-ui ToggleGroup API issues */}
      <div className="inline-flex items-center rounded-lg border border-border p-0.5 gap-0.5">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={cn(
              "px-2.5 py-1 rounded-md text-sm font-medium transition-colors cursor-pointer select-none",
              "hover:bg-muted hover:text-foreground",
              periodType === opt.value
                ? "bg-muted text-foreground shadow-sm"
                : "text-muted-foreground",
            )}
            onClick={() => onPeriodTypeChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <Select
        value={String(year)}
        onValueChange={(v) => onYearChange(Number(v))}
      >
        <SelectTrigger className="w-20 h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {periodType === "month" && (
        <Select
          value={String(month)}
          onValueChange={(v) => onMonthChange(Number(v))}
        >
          <SelectTrigger className="w-16 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <SelectItem key={m} value={String(m)}>
                {m}月
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {periodType === "quarter" && (
        <Select
          value={String(quarter)}
          onValueChange={(v) => onQuarterChange(Number(v))}
        >
          <SelectTrigger className="w-16 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map((q) => (
              <SelectItem key={q} value={String(q)}>
                Q{q}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

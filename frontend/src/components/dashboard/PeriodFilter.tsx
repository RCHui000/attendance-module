import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SegmentedPill } from "@/components/ui/segmented-pill";
import { mondayOfWeek } from "@/utils/dates";
import type { PeriodType } from "./periodUtils";

interface PeriodFilterProps {
  periodType: PeriodType;
  year: number;
  month: number;
  quarter: number;
  weekStart?: string;
  onPeriodTypeChange: (type: PeriodType) => void;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number) => void;
  onQuarterChange: (quarter: number) => void;
  onWeekStartChange?: (weekStart: string) => void;
}

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: "year", label: "年" },
  { value: "month", label: "月" },
  { value: "quarter", label: "季" },
  { value: "week", label: "周" },
];

export function PeriodFilter({
  periodType,
  year,
  month,
  quarter,
  weekStart,
  onPeriodTypeChange,
  onYearChange,
  onMonthChange,
  onQuarterChange,
  onWeekStartChange,
}: PeriodFilterProps) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <div className="flex items-center gap-2">
      <SegmentedPill
        value={periodType}
        items={PERIOD_OPTIONS}
        onChange={onPeriodTypeChange}
        ariaLabel="时间跨度"
      />

      <Select
        value={String(year)}
        onValueChange={(v) => onYearChange(Number(v))}
      >
        <SelectTrigger className="h-8 w-[5.25rem] rounded-full text-sm">
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
          <SelectTrigger className="h-8 w-[4.25rem] rounded-full text-sm">
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
          <SelectTrigger className="h-8 w-[4.25rem] rounded-full text-sm">
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

      {periodType === "week" && (
        <Input
          type="date"
          value={weekStart || ""}
          onChange={(event) => {
            if (event.target.value) onWeekStartChange?.(mondayOfWeek(event.target.value));
          }}
          className="h-8 w-[8.75rem] rounded-full text-sm"
          aria-label="选择周"
        />
      )}
    </div>
  );
}

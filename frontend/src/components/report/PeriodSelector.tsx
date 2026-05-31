import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Download } from "lucide-react";

export type PeriodType = "month" | "quarter" | "year";

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: "month", label: "月" },
  { value: "quarter", label: "季" },
  { value: "year", label: "年" },
];

interface PeriodSelectorProps {
  periodType: PeriodType;
  year: number;
  month: number;
  quarter: number;
  onPeriodTypeChange: (type: PeriodType) => void;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number) => void;
  onQuarterChange: (quarter: number) => void;
  onExport: () => void;
}

export function PeriodSelector({
  periodType,
  year,
  month,
  quarter,
  onPeriodTypeChange,
  onYearChange,
  onMonthChange,
  onQuarterChange,
  onExport,
}: PeriodSelectorProps) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <div className="flex items-center gap-3 flex-wrap mb-4">
      {/* Period type — plain buttons to avoid @base-ui ToggleGroup issues */}
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
        <SelectTrigger className="w-20 h-9 text-sm">
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
          <SelectTrigger className="w-16 h-9 text-sm">
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
          <SelectTrigger className="w-16 h-9 text-sm">
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

      <div className="flex-1" />

      <Button variant="outline" size="sm" onClick={onExport}>
        <Download className="size-3.5 mr-1" />
        导出项目工日
      </Button>
    </div>
  );
}

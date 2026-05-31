import { cn } from "@/lib/utils";
import type { Warning } from "@/utils/validation";

interface SheetWarningsProps {
  warnings: Warning[];
  dayTotals: Record<string, number>;
}

export function SheetWarnings({ warnings, dayTotals }: SheetWarningsProps) {
  const hasBlocking = warnings.some((w) => w.type === "error");

  return (
    <div className="panel rounded-lg border border-border p-3.5">
      <div className="flex items-center justify-between mb-2">
        <strong className="text-sm">校验与提示</strong>
        <span className="text-xs text-muted-foreground">每日合计</span>
      </div>

      {warnings.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无警告</p>
      ) : (
        <ul className="space-y-1">
          {warnings.map((w, i) => (
            <li
              key={i}
              className={cn(
                "text-sm",
                w.type === "error" && "text-destructive font-medium",
                w.type === "warning" && "text-warning",
                w.type === "info" && "text-muted-foreground",
              )}
            >
              {w.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

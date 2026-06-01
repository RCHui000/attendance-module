import { cn } from "@/lib/utils";

export interface BarListItem {
  label: string;
  value: number;
  /** Optional secondary text (e.g., formatted amount) */
  secondary?: string;
}

interface SimpleBarListProps {
  items: BarListItem[];
  title: string;
  /** Max bar width as fraction of container, defaults to 1 (100%) */
  maxBarFraction?: number;
  className?: string;
}

export function SimpleBarList({
  items,
  title,
  maxBarFraction = 1,
  className,
}: SimpleBarListProps) {
  const max = Math.max(...items.map((i) => i.value), 1);

  if (items.length === 0) {
    return (
      <div className={cn("rounded-lg border border-dashed border-border p-6", className)}>
        <h3 className="text-sm font-semibold mb-3">{title}</h3>
        <p className="text-xs text-muted-foreground text-center py-4">暂无数据</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-border p-4", className)}>
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      <div className="space-y-2.5">
        {items.map((item) => {
          const pct = (item.value / max) * 100 * maxBarFraction;
          return (
            <div key={item.label} className="flex items-center gap-2 text-sm">
              <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">
                {item.label}
              </span>
              <div className="flex-1 h-5 bg-muted/50 rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-sm bg-primary/70 transition-all duration-500"
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-xs tabular-nums font-medium">
                {item.secondary ?? item.value.toLocaleString("zh-CN")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

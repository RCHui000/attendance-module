import { cn } from "@/lib/utils";

interface SegmentedPillItem<T extends string> {
  value: T;
  label: string;
  meta?: string | number;
}

interface SegmentedPillProps<T extends string> {
  value: T;
  items: SegmentedPillItem<T>[];
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedPill<T extends string>({
  value,
  items,
  onChange,
  className,
}: SegmentedPillProps<T>) {
  return (
    <div
      className={cn(
        "inline-flex rounded-full border border-border bg-muted p-0.5 shadow-sm",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            className={cn(
              "inline-flex h-8 items-center justify-center rounded-full px-3 text-xs font-medium transition-all",
              "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
            )}
            onClick={() => onChange(item.value)}
            aria-pressed={active}
          >
            <span>{item.label}</span>
            {item.meta != null && (
              <span
                className={cn(
                  "ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                  active
                    ? "bg-background/20 text-primary-foreground"
                    : "bg-background/70 text-foreground/75",
                )}
              >
                {item.meta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

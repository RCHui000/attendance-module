import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SegmentedPillItem<T extends string> {
  value: T;
  label: string;
  meta?: string | number;
  icon?: ReactNode;
}

interface SegmentedPillProps<T extends string> {
  value: T;
  items: SegmentedPillItem<T>[];
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}

export function SegmentedPill<T extends string>({
  value,
  items,
  onChange,
  className,
  ariaLabel,
}: SegmentedPillProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<T, HTMLButtonElement>());
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });

  const setItemRef = useCallback(
    (itemValue: T) => (node: HTMLButtonElement | null) => {
      if (node) {
        itemRefs.current.set(itemValue, node);
        return;
      }
      itemRefs.current.delete(itemValue);
    },
    [],
  );

  const updateIndicator = useCallback(() => {
    const root = rootRef.current;
    const activeNode = itemRefs.current.get(value);
    if (!root || !activeNode) return;
    const rootRect = root.getBoundingClientRect();
    const activeRect = activeNode.getBoundingClientRect();
    setIndicator({
      left: activeRect.left - rootRect.left,
      width: activeRect.width,
      ready: true,
    });
  }, [value]);

  useLayoutEffect(() => {
    updateIndicator();
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(root);
    itemRefs.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [items, updateIndicator]);

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex rounded-full border border-slate-200/80 bg-[#f8fafc] p-0.5 shadow-sm",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-0.5 bottom-0.5 rounded-full bg-primary shadow-sm",
          "transition-[transform,width,opacity] duration-200 ease-out",
          !indicator.ready && "opacity-0",
        )}
        style={{
          width: indicator.width,
          transform: `translateX(${indicator.left}px)`,
        }}
      />
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={setItemRef(item.value)}
            type="button"
            className={cn(
              "relative z-10 inline-flex h-8 items-center justify-center rounded-full px-3 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "text-primary-foreground"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
            )}
            onClick={() => onChange(item.value)}
            aria-pressed={active}
          >
            {item.icon && <span className="mr-1.5 inline-flex items-center">{item.icon}</span>}
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

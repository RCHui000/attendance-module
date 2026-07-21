import type { ReactNode } from "react";
import { AlertCircle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted/55 dark:bg-muted/30", className)} />;
}

export function EmptyState({
  title,
  description,
  icon,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center",
        className,
      )}
    >
      <div className="mb-2 flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon || <Inbox className="size-4" aria-hidden="true" />}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-[44ch] text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

export function ErrorState({
  title = "加载失败",
  description = "请稍后重试。",
  className,
}: {
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-32 flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-destructive",
        className,
      )}
    >
      <AlertCircle className="mb-2 size-5" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs">{description}</p>
    </div>
  );
}

export function RefreshBadge({ show, label = "更新中" }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/20 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-sm">
      <span className="size-1.5 animate-pulse rounded-full bg-brand-accent" aria-hidden="true" />
      {label}
    </span>
  );
}

import { formatMoney } from "@/utils/dates";
import type { DashboardProject } from "@/types/project";

interface MobileRankingListProps {
  projects: DashboardProject[];
}

export function MobileRankingList({ projects }: MobileRankingListProps) {
  const ranked = [...projects]
    .sort((a, b) => (b.labor_days || 0) - (a.labor_days || 0))
    .slice(0, 5);

  if (ranked.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
        暂无项目投入
      </div>
    );
  }

  const maxHours = Math.max(...ranked.map((project) => project.labor_days || 0), 1);

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-app">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">项目投入 Top 5</h2>
        <span className="text-xs text-muted-foreground">按工日排序</span>
      </div>
      <div className="space-y-3">
        {ranked.map((project, index) => {
          const width = `${Math.max(((project.labor_days || 0) / maxHours) * 100, 4)}%`;

          return (
            <div key={project.id} className="space-y-1.5">
              <div className="flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <span className="mr-1 font-semibold text-muted-foreground">
                    #{index + 1}
                  </span>
                  <span className="font-medium text-foreground">{project.name}</span>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {formatMoney(project.labor_cost || 0)}
                  </p>
                </div>
                <strong className="shrink-0 tabular-nums">
                  {(project.labor_days || 0).toFixed(1)}
                </strong>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

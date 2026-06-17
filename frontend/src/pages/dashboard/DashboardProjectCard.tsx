import { Progress } from "@/components/ui/progress";
import { formatMoney } from "@/utils/dates";
import type { DashboardProject } from "@/types/project";

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

export function DashboardProjectCard({ project }: { project: DashboardProject }) {
  const recoveryRate = project.contract_amount > 0
    ? (project.received_amount / project.contract_amount) * 100
    : 0;

  return (
    <article className="rounded-lg border border-border bg-card p-3 shadow-app">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {project.name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {project.code}
          </p>
        </div>
        <strong className="shrink-0 text-sm tabular-nums">
          {(project.labor_days || 0).toFixed(1)} 工日
        </strong>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="min-w-0">
          <p className="text-muted-foreground">合同额</p>
          <p className="truncate font-semibold tabular-nums">
            {formatMoney(project.contract_amount)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground">已回款</p>
          <p className="truncate font-semibold tabular-nums">
            {formatMoney(project.received_amount)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground">毛利率</p>
          <p className="truncate font-semibold tabular-nums">
            {(project.gross_margin || 0).toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>回款率</span>
          <span className="tabular-nums">{recoveryRate.toFixed(1)}%</span>
        </div>
        <Progress value={clampPercent(recoveryRate)} className="gap-0" />
      </div>
    </article>
  );
}

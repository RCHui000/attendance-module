import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ApprovalChain, ApprovalRecords } from "@/components/review/ApprovalChain";
import { useTimesheetDetail } from "@/hooks/useApprovals";
import { statusText } from "@/lib/constants";

interface ExpandedReviewRowProps {
  timesheetId: number;
  projectId?: number | null;
  colSpan: number;
}

export function ExpandedReviewRow({ timesheetId, projectId, colSpan }: ExpandedReviewRowProps) {
  const { data, isLoading, isError } = useTimesheetDetail(timesheetId);
  const visibleEntries = projectId
    ? (data?.entries || []).filter((entry) => Number(entry.project_id) === Number(projectId))
    : data?.entries || [];
  const showFullSheet = !projectId;
  const chainMissing = Boolean(
    data &&
    (data.approval_chain_error || (data.status === "submitted" && !data.approval_chain?.length)),
  );
  const displayStatus = data?.approval_status || data?.status || "";

  return (
    <tr className="hover:bg-transparent">
      <td colSpan={colSpan} className="max-w-0 p-0 border-b">
        <div className="min-w-0 max-w-full overflow-hidden bg-table-header px-4 py-3">
          {isLoading && (
            <span className="text-sm text-muted-foreground">加载中…</span>
          )}

          {isError && (
            <span className="text-sm text-destructive">明细加载失败</span>
          )}

          {!isLoading && !isError && (!data || !visibleEntries.length) && (
            <span className="text-sm text-muted-foreground">暂无明细数据</span>
          )}

          {!isLoading && !isError && data && visibleEntries.length > 0 && (
            <>
              {/* Header strip */}
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-foreground">
                  {data.user_name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {data.department || "—"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {data.week_start_date} 至{" "}
                  {data.days?.[data.days.length - 1]}
                </span>
                {projectId && (
                  <Badge variant="outline" className="max-w-full whitespace-normal text-[10px] leading-4">
                    当前审批项目块：{visibleEntries[0]?.project_name || `项目 #${projectId}`}
                  </Badge>
                )}
                <Badge
                  variant={
                    displayStatus === "approved"
                      ? "success"
                      : displayStatus === "rejected" || displayStatus === "revision_required"
                        ? "destructive"
                        : "secondary"
                  }
                  className="text-[10px] ml-auto"
                >
                  {statusText[displayStatus] || displayStatus}
                </Badge>
              </div>

              {/* Daily breakdown table */}
              <div className="max-w-full overflow-x-auto overscroll-x-contain">
                <table className="min-w-[680px] w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 text-xs font-bold text-muted-foreground">
                      项目
                    </th>
                    {data.days?.map((day) => (
                      <th
                        key={day}
                        className="text-center py-1.5 text-xs font-bold text-muted-foreground"
                      >
                        {day.slice(5)}
                      </th>
                    ))}
                    <th className="text-right py-1.5 text-xs font-bold text-muted-foreground">
                      合计
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* Group entries by project */}
                  {(() => {
                    const projectMap = new Map<
                      number,
                      { name: string; days: Record<string, number> }
                    >();
                    visibleEntries.forEach((e) => {
                      if (!projectMap.has(e.project_id)) {
                        projectMap.set(e.project_id, {
                          name: e.project_name || `项目 #${e.project_id}`,
                          days: {},
                        });
                      }
                      const p = projectMap.get(e.project_id)!;
                      p.days[e.work_date] =
                        (p.days[e.work_date] || 0) + e.hours;
                    });
                    return Array.from(projectMap.entries()).map(
                      ([pid, p]) => {
                        const dayValues = (data.days || []).map(
                          (d) => p.days[d] || 0,
                        );
                        const total = dayValues.reduce((a, b) => a + b, 0);
                        return (
                          <tr key={pid} className="border-b border-border/50">
                            <td className="py-1.5 text-sm font-medium">
                              {p.name}
                            </td>
                            {dayValues.map((v, i) => (
                              <td
                                key={i}
                                className="py-1.5 text-center tabular-nums"
                              >
                                {v > 0
                                  ? (v * 100).toFixed(0) + "%"
                                  : "—"}
                              </td>
                            ))}
                            <td className="py-1.5 text-right tabular-nums font-medium">
                              {total.toFixed(2)}
                            </td>
                          </tr>
                        );
                      },
                    );
                  })()}

                  {/* Daily totals row */}
                  <tr className="border-t-2 border-border">
                    <td className="py-1.5 text-sm font-bold text-muted-foreground">
                      每日合计
                    </td>
                    {(data.days || []).map((day, i) => {
                      const sum = visibleEntries
                        .filter((e) => e.work_date === day)
                        .reduce((a, e) => a + e.hours, 0);
                      return (
                        <td
                          key={i}
                          className={`py-1.5 text-center tabular-nums font-bold ${
                            sum > 1 ? "text-destructive" : ""
                          }`}
                        >
                      {sum.toFixed(1)}
                        </td>
                      );
                    })}
                    <td className="py-1.5 text-right tabular-nums font-bold">
                      {visibleEntries
                        .reduce((a, e) => a + e.hours, 0)
                        .toFixed(1)}
                    </td>
                  </tr>

                  {/* Overtime row */}
                  {showFullSheet && (
                  <tr>
                    <td className="py-1.5 text-sm font-bold text-warning">
                      加班 OT
                    </td>
                    {(data.days || []).map((day, i) => {
                      const ot = (data.overtime || []).find(
                        (o) => o.work_date === day,
                      );
                      return (
                        <td
                          key={i}
                          className="py-1.5 text-center tabular-nums text-warning"
                        >
                          {ot ? ot.overtime_hours : "—"}
                        </td>
                      );
                    })}
                    <td className="py-1.5 text-right tabular-nums font-bold text-warning">
                      {(data.overtime || [])
                        .reduce(
                          (a, o) => a + (o.overtime_hours || 0),
                          0,
                        )
                        .toFixed(1)}
                    </td>
                  </tr>
                  )}
                </tbody>
                </table>
              </div>

              {/* Remark */}
              {data.remark && (
                <>
                  <Separator className="my-2" />
                  <div className="text-sm">
                    <strong className="text-muted-foreground">
                      备注：
                    </strong>
                    <span>{data.remark}</span>
                  </div>
                </>
              )}

              <Separator className="my-3" />
              <div className="min-w-0 max-w-full">
                {chainMissing ? (
                  <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                    审批链路暂未加载
                  </div>
                ) : (
                  <ApprovalChain nodes={data.approval_chain} />
                )}
                <ApprovalRecords nodes={data.approval_chain} projectId={projectId} />
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

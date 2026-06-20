import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ApprovalChain } from "@/components/review/ApprovalChain";
import { useTimesheetDetail } from "@/hooks/useApprovals";
import { statusText } from "@/lib/constants";

interface MobileTimesheetDetailProps {
  timesheetId: number;
  projectId?: number | null;
}

export function MobileTimesheetDetail({ timesheetId, projectId }: MobileTimesheetDetailProps) {
  const { data, isLoading, isError, refetch, isFetching } = useTimesheetDetail(timesheetId);
  const visibleEntries = projectId
    ? (data?.entries || []).filter((entry) => Number(entry.project_id) === Number(projectId))
    : data?.entries || [];
  const showFullSheet = !projectId;
  const activeNode = data?.approval_chain?.find((node) => node.node_status === "active");
  const canAct = Boolean(data?.approval_chain?.some((node) => node.can_current_user_act));
  const activeAssignees = activeNode?.assignees
    .filter((assignee) => assignee.status === "pending")
    .map((assignee) => assignee.assignee_name || `员工 ${assignee.assignee_user_id}`)
    .join("、");
  const chainMissing = Boolean(
    data &&
    (data.approval_chain_error || (data.status === "submitted" && !data.approval_chain?.length)),
  );

  if (isLoading) {
    return (
      <div className="mt-3 border-t border-border bg-[#f8fafc] px-3 py-4 text-sm text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mt-3 border-t border-border bg-[#f8fafc] px-3 py-4 text-sm text-destructive">
        明细加载失败
      </div>
    );
  }

  if (!data || visibleEntries.length === 0) {
    return (
      <div className="mt-3 border-t border-border bg-[#f8fafc] px-3 py-4 text-sm text-muted-foreground">
        暂无明细数据
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-border bg-[#f8fafc] px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm text-foreground">{data.user_name}</strong>
        <span className="text-xs text-muted-foreground">{data.department || "-"}</span>
        <span className="text-xs text-muted-foreground">
          {data.week_start_date} 至 {data.days?.[data.days.length - 1]}
        </span>
        <Badge
          variant={
            data.status === "approved"
              ? "success"
              : data.status === "rejected"
                ? "destructive"
                : "secondary"
          }
          className="ml-auto text-[10px]"
        >
          {statusText[data.status] || data.status}
        </Badge>
      </div>

      <div className="mt-3">
        {chainMissing ? (
          <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between gap-3">
              <span>审批线程图暂未加载</span>
              <button
                type="button"
                className="font-medium text-primary hover:underline disabled:opacity-60"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? "加载中" : "重新加载"}
              </button>
            </div>
          </div>
        ) : (
          <ApprovalChain nodes={data.approval_chain} />
        )}
      </div>
      {activeNode && !canAct && (
        <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {activeAssignees ? `当前待审批：${activeAssignees}` : "尚未轮到你审批"}
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-[560px] w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-1.5 pr-2 text-left text-xs font-bold text-muted-foreground">
                项目
              </th>
              {data.days?.map((day) => (
                <th key={day} className="py-1.5 text-center text-xs font-bold text-muted-foreground">
                  {day.slice(5)}
                </th>
              ))}
              <th className="py-1.5 pl-2 text-right text-xs font-bold text-muted-foreground">
                合计
              </th>
            </tr>
          </thead>
          <tbody>
            {projectRows(visibleEntries).map(([projectIdValue, project]) => {
              const dayValues = (data.days || []).map((day) => project.days[day] || 0);
              const total = dayValues.reduce((sum, value) => sum + value, 0);
              return (
                <tr key={projectIdValue} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 text-sm font-medium">{project.name}</td>
                  {dayValues.map((value, index) => (
                    <td key={index} className="py-1.5 text-center tabular-nums">
                      {value > 0 ? `${(value * 100).toFixed(0)}%` : "-"}
                    </td>
                  ))}
                  <td className="py-1.5 pl-2 text-right font-medium tabular-nums">
                    {total.toFixed(2)}
                  </td>
                </tr>
              );
            })}

            <tr className="border-t-2 border-border">
              <td className="py-1.5 pr-2 text-sm font-bold text-muted-foreground">
                每日合计
              </td>
              {(data.days || []).map((day) => {
                const sum = visibleEntries
                  .filter((entry) => entry.work_date === day)
                  .reduce((total, entry) => total + entry.hours, 0);
                return (
                  <td
                    key={day}
                    className={`py-1.5 text-center font-bold tabular-nums ${
                      sum > 1 ? "text-destructive" : ""
                    }`}
                  >
                    {sum.toFixed(1)}
                  </td>
                );
              })}
              <td className="py-1.5 pl-2 text-right font-bold tabular-nums">
                {visibleEntries.reduce((total, entry) => total + entry.hours, 0).toFixed(1)}
              </td>
            </tr>

            {showFullSheet && (
              <tr>
                <td className="py-1.5 pr-2 text-sm font-bold text-warning">
                  加班 OT
                </td>
                {(data.days || []).map((day) => {
                  const overtime = (data.overtime || []).find((item) => item.work_date === day);
                  return (
                    <td key={day} className="py-1.5 text-center text-warning tabular-nums">
                      {overtime ? overtime.overtime_hours : "-"}
                    </td>
                  );
                })}
                <td className="py-1.5 pl-2 text-right font-bold text-warning tabular-nums">
                  {(data.overtime || [])
                    .reduce((total, item) => total + (item.overtime_hours || 0), 0)
                    .toFixed(1)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data.remark && (
        <>
          <Separator className="my-2" />
          <p className="text-sm">
            <strong className="text-muted-foreground">备注：</strong>
            <span>{data.remark}</span>
          </p>
        </>
      )}
    </div>
  );
}

function projectRows(
  entries: Array<{ project_id: number; project_name?: string; work_date: string; hours: number }>,
) {
  const projectMap = new Map<number, { name: string; days: Record<string, number> }>();
  entries.forEach((entry) => {
    if (!projectMap.has(entry.project_id)) {
      projectMap.set(entry.project_id, {
        name: entry.project_name || `项目 #${entry.project_id}`,
        days: {},
      });
    }
    const project = projectMap.get(entry.project_id)!;
    project.days[entry.work_date] = (project.days[entry.work_date] || 0) + entry.hours;
  });
  return Array.from(projectMap.entries());
}

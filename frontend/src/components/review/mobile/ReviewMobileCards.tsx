import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MobileTimesheetDetail } from "@/components/review/mobile/MobileTimesheetDetail";
import { useOvertimeAction, useReviewAction } from "@/hooks/useApprovals";
import { statusText } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type {
  ApprovalOvertimeItem,
  ApprovalTaskItem,
  ApprovalTasks,
  ReviewedTaskItem,
} from "@/types/approval";
import { getTimesheetPeriodEnd } from "@/utils/dates";
import { Check, ChevronDown, ChevronRight, Clock3, FileText, RotateCcw, X } from "lucide-react";

interface ReviewMobileCardsProps {
  data: ApprovalTasks;
  approvalTab: "pending" | "reviewed";
}

type RejectTarget =
  | { kind: "timesheet"; item: ApprovalTaskItem }
  | { kind: "overtime"; item: ApprovalOvertimeItem }
  | null;

export function ReviewMobileCards({ data, approvalTab }: ReviewMobileCardsProps) {
  const [rejectTarget, setRejectTarget] = useState<RejectTarget>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const reviewAction = useReviewAction();
  const overtimeAction = useOvertimeAction();

  const pendingWeeks = useMemo(() => groupByWeek(data.timesheets), [data.timesheets]);
  const inProgress = useMemo(() => data.inProgress || [], [data.inProgress]);
  const inProgressWeeks = useMemo(() => groupByWeek(inProgress), [inProgress]);
  const hasPending = data.timesheets.length > 0 || inProgress.length > 0 || data.overtime.length > 0;
  const hasReviewed = data.reviewed.length > 0 || data.overtimeReviewed.length > 0;

  const closeReject = () => {
    setRejectTarget(null);
    setRejectComment("");
  };

  const confirmReject = () => {
    if (rejectTarget?.kind === "timesheet") {
      reviewAction.mutate({
        timesheetId: rejectTarget.item.timesheet_id,
        taskId: rejectTarget.item.task_id,
        action: "reject",
        comment: rejectComment || "退回",
      });
    }

    if (rejectTarget?.kind === "overtime") {
      overtimeAction.mutate({
        id: rejectTarget.item.id,
        status: "rejected",
        comment: rejectComment || "退回",
      });
    }

    closeReject();
  };

  return (
    <>
      <div className="space-y-4 pt-4">
        {approvalTab === "pending" && !hasPending && (
          <EmptyState title="暂无待审批任务" description="当前周表和加班申请都已处理。" />
        )}

        {approvalTab === "pending" &&
          pendingWeeks.map(([week, items]) => (
            <section key={week} className="space-y-2">
              <SectionTitle
                title={`${week} 至 ${getTimesheetPeriodEnd(week)}`}
                meta={`${items.length} 份周表`}
              />
              <div className="space-y-2">
                {items.map((item) => {
                  const itemKey = taskKey(item);
                  const isExpanded = expandedKey === itemKey;
                  return (
                    <TimesheetCard
                      key={itemKey}
                      item={item}
                      mode="pending"
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedKey(isExpanded ? null : itemKey)}
                      onApprove={() =>
                        reviewAction.mutate({
                          timesheetId: item.timesheet_id,
                          taskId: item.task_id,
                          action: "approve",
                        })
                      }
                      onReject={() => {
                        setRejectTarget({ kind: "timesheet", item });
                        setRejectComment("");
                      }}
                      actionPending={reviewAction.isPending}
                    />
                  );
                })}
              </div>
            </section>
          ))}

        {approvalTab === "pending" &&
          inProgressWeeks.map(([week, items]) => (
            <section key={`visible-${week}`} className="space-y-2">
              <SectionTitle
                title="流转中（未轮到我）"
                meta={`${week} 至 ${getTimesheetPeriodEnd(week)} · ${items.length} 份`}
              />
              <div className="space-y-2">
                {items.map((item) => {
                  const itemKey = `visible-${taskKey(item)}`;
                  const isExpanded = expandedKey === itemKey;
                  return (
                    <TimesheetCard
                      key={itemKey}
                      item={item}
                      mode="inProgress"
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedKey(isExpanded ? null : itemKey)}
                    />
                  );
                })}
              </div>
            </section>
          ))}

        {approvalTab === "pending" && data.overtime.length > 0 && (
          <section className="space-y-2">
            <SectionTitle title="加班 OT" meta={`${data.overtime.length} 条待处理`} />
            <div className="space-y-2">
              {data.overtime.map((item) => (
                <OvertimeCard
                  key={item.id}
                  item={item}
                  mode="pending"
                  onApprove={() => overtimeAction.mutate({ id: item.id, status: "approved" })}
                  onReject={() => {
                    setRejectTarget({ kind: "overtime", item });
                    setRejectComment("");
                  }}
                  actionPending={overtimeAction.isPending}
                />
              ))}
            </div>
          </section>
        )}

        {approvalTab === "reviewed" && !hasReviewed && (
          <EmptyState title="暂无已审批记录" description="处理后的周表和加班记录会显示在这里。" />
        )}

        {approvalTab === "reviewed" && data.reviewed.length > 0 && (
          <section className="space-y-2">
            <SectionTitle title="已审批周表" meta={`${data.reviewed.length} 份`} />
            <div className="space-y-2">
              {data.reviewed.map((item) => {
                const itemKey = taskKey(item);
                const isExpanded = expandedKey === itemKey;
                return (
                  <TimesheetCard
                    key={itemKey}
                    item={item}
                    mode="reviewed"
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedKey(isExpanded ? null : itemKey)}
                    onReopen={() =>
                      reviewAction.mutate({
                        timesheetId: item.timesheet_id,
                        action: "reopen",
                        comment: "重新打开",
                      })
                    }
                    actionPending={reviewAction.isPending}
                  />
                );
              })}
            </div>
          </section>
        )}

        {approvalTab === "reviewed" && data.overtimeReviewed.length > 0 && (
          <section className="space-y-2">
            <SectionTitle title="已审批加班 OT" meta={`${data.overtimeReviewed.length} 条`} />
            <div className="space-y-2">
              {data.overtimeReviewed.map((item) => (
                <OvertimeCard key={item.id} item={item} mode="reviewed" />
              ))}
            </div>
          </section>
        )}
      </div>

      <AlertDialog open={rejectTarget != null} onOpenChange={(open) => { if (!open) closeReject(); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {rejectTarget?.kind === "overtime" ? "退回加班申请" : "退回周表"}
            </AlertDialogTitle>
            <AlertDialogDescription>请输入退回原因，留空将使用默认原因。</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            rows={3}
            placeholder="退回原因（可选）"
            value={rejectComment}
            onChange={(event) => setRejectComment(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReject}>确认退回</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TimesheetCard({
  item,
  mode,
  isExpanded,
  onToggle,
  onApprove,
  onReject,
  onReopen,
  actionPending,
}: {
  item: ApprovalTaskItem | ReviewedTaskItem;
  mode: "pending" | "inProgress" | "reviewed";
  isExpanded: boolean;
  onToggle: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onReopen?: () => void;
  actionPending?: boolean;
}) {
  const scopeLabel =
    item.scope_type === "project"
      ? `${item.project_code || ""} ${item.project_name || "项目审批"}`.trim()
      : "部门汇总确认";
  const status = mode === "reviewed" ? item.status : item.scope_type || "timesheet";
  const variant =
    item.status === "approved"
      ? ("success" as const)
      : item.status === "rejected"
        ? ("destructive" as const)
        : ("secondary" as const);

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <button type="button" className="block w-full p-3 text-left" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="size-4 shrink-0 text-primary" />
              <h2 className="truncate text-base font-semibold">{item.name}</h2>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {item.department || "-"} · {item.week_start_date}
            </p>
          </div>
          {isExpanded ? (
            <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant={mode === "reviewed" ? variant : "secondary"} className="max-w-full">
            {mode === "reviewed"
              ? statusText[status] || status
              : mode === "inProgress" && "current_assignee_names" in item && item.current_assignee_names
                ? `当前待审批：${item.current_assignee_names}`
                : scopeLabel}
          </Badge>
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
            {item.total_hours?.toFixed(item.scope_type === "project" ? 2 : 1)} h
          </span>
        </div>

        {"review_comment" in item && item.review_comment && (
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{item.review_comment}</p>
        )}
      </button>

      {isExpanded && (
        <MobileTimesheetDetail
          timesheetId={item.timesheet_id}
          projectId={item.project_id || null}
        />
      )}

      <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
        {mode === "pending" ? (
          <>
            <Button
              variant="outline"
              className="h-10 text-success"
              onClick={onApprove}
              disabled={actionPending}
            >
              <Check className="mr-1 size-4" />
              通过
            </Button>
            <Button
              variant="outline"
              className="h-10 text-destructive"
              onClick={onReject}
              disabled={actionPending}
            >
              <X className="mr-1 size-4" />
              退回
            </Button>
          </>
        ) : mode === "reviewed" ? (
          <Button
            variant="outline"
            className="col-span-2 h-10"
            onClick={onReopen}
            disabled={actionPending}
          >
            <RotateCcw className="mr-1 size-4" />
            重新打开
          </Button>
        ) : (
          <div className="col-span-2 rounded-md bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
            仅查看，尚未轮到你审批
          </div>
        )}
      </div>
    </article>
  );
}

function OvertimeCard({
  item,
  mode,
  onApprove,
  onReject,
  actionPending,
}: {
  item: ApprovalOvertimeItem;
  mode: "pending" | "reviewed";
  onApprove?: () => void;
  onReject?: () => void;
  actionPending?: boolean;
}) {
  const statusVariant =
    item.status === "approved" ? ("success" as const) : item.status === "rejected" ? ("destructive" as const) : ("secondary" as const);

  return (
    <article className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Clock3 className="size-4 text-warning" />
            <h2 className="text-base font-semibold">{item.user_name}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{item.work_date}</p>
        </div>
        <Badge variant={mode === "reviewed" ? statusVariant : "outline"}>
          {mode === "reviewed" ? statusText[item.status] || item.status : `${item.overtime_hours} h`}
        </Badge>
      </div>
      <p className={cn("mt-3 text-sm", item.reason ? "text-foreground" : "text-muted-foreground")}>
        {item.reason || "未填写原因"}
      </p>
      {mode === "pending" && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
          <Button
            variant="outline"
            className="h-10 text-success"
            onClick={onApprove}
            disabled={actionPending}
          >
            <Check className="mr-1 size-4" />
            通过
          </Button>
          <Button
            variant="outline"
            className="h-10 text-destructive"
            onClick={onReject}
            disabled={actionPending}
          >
            <X className="mr-1 size-4" />
            退回
          </Button>
        </div>
      )}
    </article>
  );
}

function SectionTitle({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className="text-xs text-muted-foreground">{meta}</span>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function groupByWeek(items: ApprovalTaskItem[]) {
  const grouped = new Map<string, ApprovalTaskItem[]>();
  for (const item of items) {
    if (!grouped.has(item.week_start_date)) grouped.set(item.week_start_date, []);
    grouped.get(item.week_start_date)!.push(item);
  }
  return Array.from(grouped.entries());
}

function taskKey(item: ApprovalTaskItem | ReviewedTaskItem) {
  return `${item.task_id || item.timesheet_id}:${item.scope_type || "timesheet"}:${item.scope_id || "all"}`;
}

import { Fragment, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SegmentedPill } from "@/components/ui/segmented-pill";
import { getTimesheetPeriodEnd } from "@/utils/dates";
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
import { statusText } from "@/lib/constants";
import { useReviewAction, useOvertimeAction } from "@/hooks/useApprovals";
import type {
  ApprovalTasks,
  ApprovalTaskItem,
  ReviewedTaskItem,
} from "@/types/approval";
import { ExpandedReviewRow } from "./ExpandedReviewRow";
import { Check, X, Undo2, ChevronDown, ChevronRight } from "lucide-react";

interface ApprovalTableProps {
  data: ApprovalTasks;
  approvalTab: "pending" | "reviewed";
  onTabChange: (tab: "pending" | "reviewed") => void;
}

export function ApprovalTable({
  data,
  approvalTab,
  onTabChange,
}: ApprovalTableProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{
    type: "timesheet";
    id: number;
    taskId?: number;
  } | null>(null);
  const [rejectOTTarget, setRejectOTTarget] = useState<{
    type: "overtime";
    id: number;
  } | null>(null);
  const [rejectComment, setRejectComment] = useState("");

  const reviewAction = useReviewAction();
  const overtimeAction = useOvertimeAction();
  const inProgress = data.inProgress || [];
  const approvalTabs = [
    { value: "pending" as const, label: "待审批" },
    { value: "reviewed" as const, label: "已审核" },
  ];

  const getTaskKey = (item: ApprovalTaskItem | ReviewedTaskItem) =>
    `${item.task_id || item.timesheet_id}:${item.scope_type || "timesheet"}:${item.scope_id || "all"}`;

  // ---- Timesheet actions ----
  const handleApprove = (item: ApprovalTaskItem) => {
    reviewAction.mutate({
      timesheetId: item.timesheet_id,
      taskId: item.task_id,
      action: "approve",
    });
  };

  const handleReject = (item: ApprovalTaskItem) => {
    setRejectTarget({ type: "timesheet", id: item.timesheet_id, taskId: item.task_id });
    setRejectComment("");
  };

  const handleReopen = (id: number) => {
    reviewAction.mutate({
      timesheetId: id,
      action: "reopen",
      comment: "重新打开",
    });
  };

  const confirmReject = () => {
    if (rejectTarget && rejectTarget.type === "timesheet") {
      reviewAction.mutate({
        timesheetId: rejectTarget.id,
        taskId: rejectTarget.taskId,
        action: "reject",
        comment: rejectComment || "退回",
      });
    }
    setRejectTarget(null);
  };

  // ---- Overtime actions ----
  const handleOTApprove = (id: number) => {
    overtimeAction.mutate({ id, status: "approved" });
  };

  const handleOTReject = (id: number) => {
    setRejectOTTarget({ type: "overtime", id });
    setRejectComment("");
  };

  const confirmOTReject = () => {
    if (rejectOTTarget && rejectOTTarget.type === "overtime") {
      overtimeAction.mutate({
        id: rejectOTTarget.id,
        status: "rejected",
        comment: rejectComment || "退回",
      });
    }
    setRejectOTTarget(null);
  };

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-3">
          <SegmentedPill
            value={approvalTab}
            items={approvalTabs}
            onChange={onTabChange}
            ariaLabel="审批状态"
          />
          <span className="text-xs text-muted-foreground">
            {approvalTab === "pending"
              ? "处理待审批周表和加班 OT"
              : "查看已处理的审批记录"}
          </span>
        </div>

        {/* Timesheet approval */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <strong className="text-sm">周表</strong>
            <span className="text-xs text-muted-foreground">待审批 / 流转中可见</span>
          </div>

          {approvalTab === "pending" && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="overflow-auto max-h-[40vh]">
                <Table>
                  <TableHeader className="sticky top-0 bg-table-header">
                    <TableRow>
                      <TableHead className="text-xs font-bold w-7" />
                      <TableHead className="text-xs font-bold">姓名</TableHead>
                      <TableHead className="text-xs font-bold">部门</TableHead>
                      <TableHead className="text-xs font-bold">状态</TableHead>
                      <TableHead className="text-xs font-bold text-right">总工日</TableHead>
                      <TableHead className="text-xs font-bold">提交时间</TableHead>
                      <TableHead className="text-xs font-bold text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.timesheets.length === 0 && inProgress.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-6">
                          暂无待审批周表
                        </TableCell>
                      </TableRow>
                    )}
                    {/* Group by week, add divider between weeks */}
                    {(() => {
                      const grouped = new Map<string, typeof data.timesheets>();
                      for (const item of data.timesheets) {
                        const week = item.week_start_date;
                        if (!grouped.has(week)) grouped.set(week, []);
                        grouped.get(week)!.push(item);
                      }
                      const rows: React.ReactNode[] = [];
                      for (const [week, items] of grouped) {
                        // Week divider
                        const weekEnd = getTimesheetPeriodEnd(week);
                        rows.push(
                          <TableRow key={`week-divider-${week}`} className="bg-table-header hover:bg-table-header">
                            <TableCell colSpan={7} className="py-1.5 px-3">
                              <span className="text-xs font-bold text-muted-foreground">
                                {week} 至 {weekEnd}
                              </span>
                              <span className="text-xs text-muted-foreground ml-2">
                                {items.length} 份周表
                              </span>
                            </TableCell>
                          </TableRow>,
                        );
                        for (const item of items) {
                          const itemKey = getTaskKey(item);
                          const isExpanded = expandedKey === itemKey;
                          rows.push(
                            <ApprovalRow
                              key={itemKey}
                              item={item}
                              isExpanded={isExpanded}
                              onToggle={() =>
                                setExpandedKey(isExpanded ? null : itemKey)
                              }
                              onApprove={handleApprove}
                              onReject={handleReject}
                            />,
                          );
                          if (isExpanded) {
                            rows.push(
                              <ExpandedReviewRow
                                key={`detail-${itemKey}`}
                                timesheetId={item.timesheet_id}
                                projectId={item.project_id || null}
                                colSpan={7}
                              />,
                            );
                          }
                        }
                      }
                      return rows;
                    })()}
                    {inProgress.length > 0 && (
                      <TableRow className="bg-table-header hover:bg-table-header">
                        <TableCell colSpan={7} className="py-1.5 px-3">
                          <span className="text-xs font-bold text-muted-foreground">
                            流转中（未轮到我）
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {inProgress.length} 份周表
                          </span>
                        </TableCell>
                      </TableRow>
                    )}
                    {inProgress.map((item) => {
                      const itemKey = `visible-${getTaskKey(item)}`;
                      const isExpanded = expandedKey === itemKey;
                      return (
                        <Fragment key={itemKey}>
                          <InProgressRow
                            item={item}
                            isExpanded={isExpanded}
                            onToggle={() =>
                              setExpandedKey(isExpanded ? null : itemKey)
                            }
                          />
                          {isExpanded && (
                            <ExpandedReviewRow
                              key={`detail-${itemKey}`}
                              timesheetId={item.timesheet_id}
                              projectId={item.project_id || null}
                              colSpan={7}
                            />
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {approvalTab === "reviewed" && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="overflow-auto max-h-[40vh]">
                <Table>
                  <TableHeader className="sticky top-0 bg-table-header">
                    <TableRow>
                      <TableHead className="text-xs font-bold w-7" />
                      <TableHead className="text-xs font-bold">姓名</TableHead>
                      <TableHead className="text-xs font-bold">部门</TableHead>
                      <TableHead className="text-xs font-bold">结果</TableHead>
                      <TableHead className="text-xs font-bold text-right">总工日</TableHead>
                      <TableHead className="text-xs font-bold">批注</TableHead>
                      <TableHead className="text-xs font-bold text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.reviewed.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-6">
                          暂无已审核记录
                        </TableCell>
                      </TableRow>
                    )}
                    {data.reviewed.map((item) => {
                      const itemKey = getTaskKey(item);
                      const isExpanded = expandedKey === itemKey;
                      return (
                        <Fragment key={itemKey}>
                          <ReviewedRow
                            item={item}
                            isExpanded={isExpanded}
                            onToggle={() =>
                              setExpandedKey(isExpanded ? null : itemKey)
                            }
                            onReopen={handleReopen}
                          />
                          {isExpanded && (
                            <ExpandedReviewRow
                              key={`detail-${itemKey}`}
                              timesheetId={item.timesheet_id}
                              projectId={item.project_id || null}
                              colSpan={7}
                            />
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        {/* Overtime approval */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <strong className="text-sm">加班 OT</strong>
            <span className="text-xs text-muted-foreground">待处理</span>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-auto max-h-[30vh]">
              <Table>
                <TableHeader className="sticky top-0 bg-table-header">
                  <TableRow>
                    <TableHead className="text-xs font-bold">员工</TableHead>
                    <TableHead className="text-xs font-bold">日期</TableHead>
                    <TableHead className="text-xs font-bold text-right">加班时数</TableHead>
                    <TableHead className="text-xs font-bold">原因</TableHead>
                    <TableHead className="text-xs font-bold text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.overtime.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6">
                        暂无待审批加班
                      </TableCell>
                    </TableRow>
                  )}
                  {data.overtime.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm font-medium">
                        {item.user_name}
                      </TableCell>
                      <TableCell className="text-sm">{item.work_date}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {item.overtime_hours}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.reason || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-success"
                            onClick={() => handleOTApprove(item.id)}
                          >
                            <Check className="size-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-destructive"
                            onClick={() => handleOTReject(item.id)}
                          >
                            <X className="size-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>

      {/* Reject confirmation dialog */}
      <AlertDialog
        open={rejectTarget != null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>退回周表</AlertDialogTitle>
            <AlertDialogDescription>
              请输入退回原因：
            </AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/20"
            rows={3}
            placeholder="退回原因（可选）"
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReject}>
              确认退回
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* OT Reject confirmation */}
      <AlertDialog
        open={rejectOTTarget != null}
        onOpenChange={(open) => {
          if (!open) setRejectOTTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>退回加班申请</AlertDialogTitle>
            <AlertDialogDescription>
              请输入退回原因：
            </AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/20"
            rows={3}
            placeholder="退回原因（可选）"
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmOTReject}>
              确认退回
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Pending row sub-component */
function ApprovalRow({
  item,
  isExpanded,
  onToggle,
  onApprove,
  onReject,
}: {
  item: ApprovalTaskItem;
  isExpanded: boolean;
  onToggle: () => void;
  onApprove: (item: ApprovalTaskItem) => void;
  onReject: (item: ApprovalTaskItem) => void;
}) {
  const scopeLabel =
    item.scope_type === "project"
      ? `${item.project_code || ""} ${item.project_name || "项目审批"}`.trim()
      : "部门汇总确认";
  return (
    <TableRow
      className="hover:bg-row-hover cursor-pointer"
      onClick={onToggle}
    >
      <TableCell className="w-7 p-0">
        <div className="flex items-center justify-center">
          {isExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm font-medium">{item.name}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {item.department || "—"}
      </TableCell>
      <TableCell>
        <Badge variant={item.scope_type === "department_summary" ? "default" : "secondary"} className="text-xs">
          {scopeLabel}
        </Badge>
      </TableCell>
      <TableCell className="text-sm text-right tabular-nums">
        {item.total_hours?.toFixed(item.scope_type === "project" ? 2 : 1)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {item.submitted_at
          ? new Date(item.submitted_at).toLocaleDateString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—"}
      </TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-1 justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-success"
            onClick={(e) => {
              e.stopPropagation();
              onApprove(item);
            }}
          >
            <Check className="size-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onReject(item);
            }}
          >
            <X className="size-3" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function InProgressRow({
  item,
  isExpanded,
  onToggle,
}: {
  item: ApprovalTaskItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <TableRow
      className="hover:bg-row-hover cursor-pointer"
      onClick={onToggle}
    >
      <TableCell className="w-7 p-0">
        <div className="flex items-center justify-center">
          {isExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm font-medium">{item.name}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {item.department || "—"}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-xs">
          {item.current_assignee_names ? `当前待审批：${item.current_assignee_names}` : "尚未轮到你"}
        </Badge>
      </TableCell>
      <TableCell className="text-sm text-right tabular-nums">
        {item.total_hours?.toFixed(1)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {item.submitted_at
          ? new Date(item.submitted_at).toLocaleDateString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—"}
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">
        仅查看
      </TableCell>
    </TableRow>
  );
}

/** Reviewed row sub-component */
function ReviewedRow({
  item,
  isExpanded,
  onToggle,
  onReopen,
}: {
  item: ReviewedTaskItem;
  isExpanded: boolean;
  onToggle: () => void;
  onReopen: (id: number) => void;
}) {
  const status = item.status;
  const variant =
    status === "approved"
      ? ("success" as const)
      : status === "rejected"
        ? ("destructive" as const)
        : ("secondary" as const);

  return (
    <TableRow
      className="hover:bg-row-hover cursor-pointer"
      onClick={onToggle}
    >
      <TableCell className="w-7 p-0">
        <div className="flex items-center justify-center">
          {isExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm font-medium">{item.name}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {item.department || "—"}
      </TableCell>
      <TableCell>
        <Badge variant={variant} className="text-xs">
          {statusText[status] || status}
        </Badge>
      </TableCell>
      <TableCell className="text-sm text-right tabular-nums">
        {item.total_hours?.toFixed(item.scope_type === "project" ? 2 : 1)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {item.review_comment || "—"}
      </TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-1 justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={(e) => {
              e.stopPropagation();
              onReopen(item.timesheet_id);
            }}
          >
            <Undo2 className="size-3" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

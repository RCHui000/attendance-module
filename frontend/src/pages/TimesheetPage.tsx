import { useEffect, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { WeekNavigator } from "@/components/timesheet/WeekNavigator";
import { TimesheetTable } from "@/components/timesheet/TimesheetTable";
import { SheetWarnings } from "@/components/timesheet/SheetWarnings";
import { SheetActions } from "@/components/timesheet/SheetActions";
import { useTimesheetStore } from "@/stores/timesheetStore";
import { useAppStore } from "@/stores/appStore";
import {
  useTimesheet,
  useSaveTimesheet,
  useSubmitTimesheet,
  useWithdrawTimesheet,
} from "@/hooks/useTimesheet";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { statusText } from "@/lib/constants";
import {
  formatTimesheetError,
  validateTimesheetPayload,
} from "@/lib/timesheetErrors";
import {
  getTimesheetDisplayWeekDays,
  getTimesheetPeriodDays,
  getTimesheetPeriodEnd,
} from "@/utils/dates";
import {
  buildWarnings,
  dayPercent,
  formatWorkdays,
  hasBlockingError,
  weekWorkdays,
} from "@/utils/validation";
import type { ProjectBrief } from "@/types/auth";
import type { SaveTimesheetPayload, TimesheetRow } from "@/types/timesheet";
import { toast } from "sonner";

function showTimesheetError(message: string) {
  toast.error(message, {
    action: {
      label: "复制详情",
      onClick: () => {
        void navigator.clipboard?.writeText(message);
      },
    },
  });
}

function isRowWriteLocked(row: TimesheetRow): boolean {
  return (
    row.approvalStatus === "approved" ||
    row.approvalStatus === "summary_pending" ||
    row.approvalStatus === "pending"
  );
}

function hasWorkIntentSlot(row: TimesheetRow, weekDays: string[]): boolean {
  if (isRowWriteLocked(row)) return false;
  const hasWorkdays = weekDays.some((day) => (row.percents[day] || 0) > 0);
  return !hasWorkdays;
}

function needsWorkIntentSlot(rows: TimesheetRow[], weekDays: string[]): boolean {
  const partialDays = weekDays.filter((day) => {
    const total = dayPercent(rows, day);
    return total > 0 && total < 100;
  });
  if (partialDays.length === 0) return false;
  return !rows.some((row) => hasWorkIntentSlot(row, weekDays));
}

export default function TimesheetPage() {
  const { currentWeek, setCurrentWeek } = useAppStore();
  const store = useTimesheetStore();
  const initFromServer = useTimesheetStore((state) => state.initFromServer);
  const resetTimesheetStore = useTimesheetStore((state) => state.reset);

  const { data: timesheet, isLoading, refetch } = useTimesheet(currentWeek);

  // Fetch projects for the dropdown
  const { data: projectList } = useQuery<ProjectBrief[]>({
    queryKey: ["timesheet-projects"],
    queryFn: () => api<ProjectBrief[]>("/api/projects"),
    staleTime: 60_000,
  });

  const saveMutation = useSaveTimesheet();
  const submitMutation = useSubmitTimesheet();
  const withdrawMutation = useWithdrawTimesheet();

  const weekDays = useMemo(() => getTimesheetPeriodDays(currentWeek), [currentWeek]);
  const displayWeekDays = useMemo(() => getTimesheetDisplayWeekDays(currentWeek), [currentWeek]);
  const serverRevisionKey = useMemo(() => {
    if (!timesheet) return "empty";
    const projectStatuses = (timesheet.project_statuses || [])
      .map((item) => `${item.project_id}:${item.status}:${item.result_action || ""}:${item.completed_at || ""}`)
      .join("|");
    const entries = (timesheet.entries || [])
      .map((entry) => `${entry.project_id}:${entry.work_date}:${entry.hours}:${entry.description || ""}`)
      .join("|");
    return [
      timesheet.id,
      timesheet.status,
      timesheet.updated_at || "",
      timesheet.remark || "",
      projectStatuses,
      entries,
    ].join("::");
  }, [timesheet]);

  // Initialize store from server data
  useEffect(() => {
    if (timesheet) {
      initFromServer({
        entries: timesheet.entries || [],
        overtime: timesheet.overtime || [],
        projectStatuses: timesheet.project_statuses || [],
        remark: timesheet.remark || "",
        weekDays: timesheet.days || weekDays,
      });
    } else {
      resetTimesheetStore();
    }
  }, [initFromServer, resetTimesheetStore, serverRevisionKey, timesheet, weekDays]);

  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    weekDays.forEach((d) => {
      totals[d] = dayPercent(store.rows, d);
    });
    return totals;
  }, [store.rows, weekDays]);

  const warnings = useMemo(
    () => buildWarnings(store.rows, store.overtime, weekDays),
    [store.rows, store.overtime, weekDays],
  );

  const blocking = useMemo(
    () => hasBlockingError(store.rows, weekDays),
    [store.rows, weekDays],
  );

  const weekWorkdaysVal = useMemo(
    () => weekWorkdays(store.rows, weekDays),
    [store.rows, weekDays],
  );
  const status = timesheet?.status || "draft";
  const timesheetId = timesheet?.id;
  const isLocked = ["approved", "locked", "summarized"].includes(status);
  const hasRejectedProject = store.rows.some((row) => row.approvalStatus === "rejected");
  const shouldShowDraftProjectRow =
    !isLocked && ["draft", "rejected", "revision_required"].includes(status);

  useEffect(() => {
    if (!timesheet || !shouldShowDraftProjectRow) return;
    useTimesheetStore.getState().ensureDraftProjectRow();
  }, [serverRevisionKey, shouldShowDraftProjectRow, timesheet]);

  const handleEditComplete = useCallback((context?: { day?: string }) => {
    if (isLocked) return;
    if (status === "submitted" && !hasRejectedProject) return;
    const rows = useTimesheetStore.getState().rows;
    const intentDays = context?.day ? [context.day] : weekDays;
    if (needsWorkIntentSlot(rows, intentDays)) store.ensureEmptyRow(store.isDirty);
  }, [hasRejectedProject, isLocked, status, store, weekDays]);

  const buildPayload = useCallback((): SaveTimesheetPayload => {
    const entries = store.rows.flatMap((row) =>
      {
        const rowDescription =
          row.descriptions.__row ||
          Object.values(row.descriptions).find((d) => d?.trim()) ||
          "";
        return weekDays
          .filter((d) => (row.percents[d] || 0) > 0)
          .map((d) => ({
            projectId: row.projectId,
            workDate: d,
            hours: (row.percents[d] || 0) / 100,
            description: rowDescription,
          }));
      },
    );

    const overtime = weekDays
      .filter((d) => (store.overtime[d]?.hours || 0) > 0)
      .map((d) => ({
        workDate: d,
        hours: store.overtime[d]?.hours || 0,
        reason: store.overtime[d]?.reason || "",
      }));
    const projectRevisions = store.rows
      .filter((row) => row.approvalStatus === "rejected")
      .map((row) => ({
        oldProjectId: Number(row.originalProjectId || row.projectId || 0),
        newProjectId: Number(row.projectId || 0),
      }))
      .filter((revision) => revision.oldProjectId && revision.newProjectId && revision.oldProjectId !== revision.newProjectId);

    return {
      weekStart: currentWeek,
      remark: store.remark,
      entries,
      overtime,
      projectRevisions,
    };
  }, [currentWeek, store.overtime, store.remark, store.rows, weekDays]);

  const handleSave = useCallback(async () => {
    try {
      if (blocking) {
        toast.error("请先修正每日或每周普通工日超额");
        return;
      }
      const payload = buildPayload();
      const payloadError = validateTimesheetPayload(payload);
      if (payloadError) {
        showTimesheetError(payloadError);
        return;
      }
      await saveMutation.mutateAsync(payload);
      store.markClean();
      toast.success("保存成功");
      refetch();
    } catch (e) {
      showTimesheetError(formatTimesheetError(e, "save"));
    }
  }, [blocking, buildPayload, refetch, saveMutation, store]);

  const handleSubmit = useCallback(async () => {
    try {
      if (blocking) {
        toast.error("请先修正每日或每周普通工日超额");
        return;
      }
      let id = timesheetId;
      if (store.isDirty || !id) {
        const payload = buildPayload();
        const payloadError = validateTimesheetPayload(payload);
        if (payloadError) {
          showTimesheetError(payloadError);
          return;
        }
        const result = await saveMutation.mutateAsync(payload);
        id = (result as { timesheet?: { id: number } })?.timesheet?.id || id;
      }
      if (!id) throw new Error("Timesheet id is required");
      await submitMutation.mutateAsync({
        timesheetId: id,
        action: "submit",
      });
      store.markClean();
      toast.success("已提交审核");
      refetch();
    } catch (e) {
      showTimesheetError(formatTimesheetError(e, "submit"));
    }
  }, [blocking, buildPayload, refetch, saveMutation, store, submitMutation, timesheetId]);

  const handleWithdraw = useCallback(async () => {
    if (!timesheetId) return;
    const confirmed = window.confirm("撤回后周表会回到草稿，已分发的项目块审批任务会被取消。确定撤回吗？");
    if (!confirmed) return;

    try {
      await withdrawMutation.mutateAsync({
        timesheetId,
        comment: "提交人撤回周表",
      });
      store.markClean();
      toast.success("周表已撤回，可继续编辑");
      refetch();
    } catch (e) {
      showTimesheetError(formatTimesheetError(e, "withdraw"));
    }
  }, [timesheetId, withdrawMutation, store, refetch]);

  if (isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between gap-3 max-[900px]:flex-col max-[900px]:items-start">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[22px] font-bold leading-tight">
              {currentWeek} 至 {getTimesheetPeriodEnd(currentWeek)}
            </h2>
            <WeekNavigator
              currentWeek={currentWeek}
              onWeekChange={setCurrentWeek}
            />
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={
                status === "approved"
                  ? "success"
                  : status === "rejected"
                    ? "destructive"
                    : status === "submitted"
                      ? "default"
                      : "secondary"
              }
              className="text-xs"
            >
              {statusText[status] || status}
            </Badge>
            <strong className="text-lg tabular-nums">
              {formatWorkdays(weekWorkdaysVal)} 工日
            </strong>
          </div>
        </div>
      </div>

      {/* Table */}
      <TimesheetTable
        rows={store.rows}
        overtime={store.overtime}
        weekDays={displayWeekDays}
        activeDays={weekDays}
        projects={projectList || []}
        status={status}
        isLocked={isLocked}
        dayTotals={dayTotals}
        onUpdatePercent={store.updatePercent}
        onUpdateOvertime={store.updateOvertime}
        onUpdateDescription={(ri, d, v) => store.updateDescription(ri, d, v)}
        onUpdateProject={store.updateProject}
        onEditComplete={handleEditComplete}
        onAddRow={store.addRow}
        onRemoveRow={store.removeRow}
      />

      {/* Lower grid: Remark + Warnings */}
      <div className="grid grid-cols-[1.1fr_0.9fr] gap-3.5 mt-3.5 max-[900px]:grid-cols-1">
        <div className="panel rounded-lg border border-border p-3.5">
          <label className="block text-sm font-medium mb-1">周备注</label>
          <Textarea
            rows={4}
            className="text-sm resize-none"
            value={store.remark}
            onChange={(e) => store.setRemark(e.target.value)}
            disabled={isLocked || status === "submitted"}
            placeholder="填写本周重点工作、请假、外勤或特殊情况…"
          />
        </div>
        <SheetWarnings warnings={warnings} />
      </div>

      {/* Actions */}
      <SheetActions
        status={status}
        canEditSubmittedRevision={status === "submitted" && hasRejectedProject}
        hasBlockingError={blocking}
        isDirty={store.isDirty}
        isSaving={saveMutation.isPending}
        isSubmitting={submitMutation.isPending || saveMutation.isPending}
        isWithdrawing={withdrawMutation.isPending}
        onSave={handleSave}
        onSubmit={handleSubmit}
        onWithdraw={status === "submitted" ? handleWithdraw : undefined}
      />
    </div>
  );
}

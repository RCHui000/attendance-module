import { useEffect, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { WeekNavigator } from "@/components/timesheet/WeekNavigator";
import { TimesheetTable } from "@/components/timesheet/TimesheetTable";
import { SheetWarnings } from "@/components/timesheet/SheetWarnings";
import { SheetActions } from "@/components/timesheet/SheetActions";
import { useTimesheetStore } from "@/stores/timesheetStore";
import { useAppStore } from "@/stores/appStore";
import { useAuthStore } from "@/stores/authStore";
import {
  useTimesheet,
  useSaveTimesheet,
  useSubmitTimesheet,
} from "@/hooks/useTimesheet";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { statusText } from "@/lib/constants";
import { addDaysToIso, getWeekDays } from "@/utils/dates";
import { dayPercent, buildWarnings, hasBlockingError } from "@/utils/validation";
import type { ProjectBrief } from "@/types/auth";
import type { SaveTimesheetPayload } from "@/types/timesheet";
import { toast } from "sonner";

export default function TimesheetPage() {
  const { currentWeek, setCurrentWeek } = useAppStore();
  const { user } = useAuthStore();
  const store = useTimesheetStore();

  const { data: timesheet, isLoading, refetch } = useTimesheet(currentWeek, {
    pauseRealtime: store.isDirty,
  });

  // Fetch projects for the dropdown
  const { data: projectList } = useQuery<ProjectBrief[]>({
    queryKey: ["timesheet-projects"],
    queryFn: () => api<ProjectBrief[]>("/api/projects"),
    staleTime: 60_000,
  });

  const saveMutation = useSaveTimesheet();
  const submitMutation = useSubmitTimesheet();

  const weekDays = useMemo(() => getWeekDays(currentWeek), [currentWeek]);

  // Initialize store from server data
  useEffect(() => {
    if (timesheet) {
      store.initFromServer({
        entries: timesheet.entries || [],
        overtime: timesheet.overtime || [],
        projectStatuses: timesheet.project_statuses || [],
        remark: timesheet.remark || "",
        weekDays: timesheet.days || weekDays,
      });
    } else {
      store.reset();
    }
  }, [timesheet?.id]);

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
    () =>
      weekDays.reduce(
        (s, d) => s + Math.min(dayTotals[d], 100) / 100,
        0,
      ),
    [dayTotals, weekDays],
  );

  const status = timesheet?.status || "draft";
  const isLocked = ["submitted", "approved", "locked", "summarized"].includes(
    status,
  );

  const buildPayload = (): SaveTimesheetPayload => {
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

    return {
      weekStart: currentWeek,
      remark: store.remark,
      entries,
      overtime,
    };
  };

  const handleSave = useCallback(async () => {
    try {
      await saveMutation.mutateAsync(buildPayload());
      store.markClean();
      toast.success("保存成功");
      refetch();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "保存失败",
      );
    }
  }, [store.rows, store.overtime, store.remark, currentWeek]);

  const handleSubmit = useCallback(async () => {
    try {
      let id = timesheet?.id;
      if (store.isDirty || !id) {
        const result = await saveMutation.mutateAsync(buildPayload());
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
      toast.error(
        e instanceof Error ? e.message : "提交失败",
      );
    }
  }, [timesheet?.id, store.rows, store.overtime, store.remark, store.isDirty, currentWeek]);

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
      <div className="flex items-start justify-between mb-4 max-[900px]:flex-col max-[900px]:gap-3">
        <div>
          <span className="text-xs font-bold tracking-wider uppercase text-muted-foreground">
            {user?.name}
          </span>
          <div className="flex items-center gap-3 mt-1">
            <h2 className="text-[22px] font-bold leading-tight">
              {currentWeek} 至 {addDaysToIso(currentWeek, 6)}
            </h2>
            <WeekNavigator
              currentWeek={currentWeek}
              onWeekChange={setCurrentWeek}
            />
          </div>
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
            {weekWorkdaysVal.toFixed(1)} 工日
          </strong>
        </div>
      </div>

      {/* Table */}
      <TimesheetTable
        rows={store.rows}
        overtime={store.overtime}
        weekDays={weekDays}
        projects={projectList || []}
        status={status}
        isLocked={isLocked}
        dayTotals={dayTotals}
        onUpdatePercent={store.updatePercent}
        onUpdateOvertime={store.updateOvertime}
        onUpdateDescription={(ri, d, v) => store.updateDescription(ri, d, v)}
        onUpdateProject={store.updateProject}
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
            disabled={isLocked}
            placeholder="填写本周重点工作、请假、外勤或特殊情况…"
          />
        </div>
        <SheetWarnings warnings={warnings} />
      </div>

      {/* Actions */}
      <SheetActions
        status={status}
        hasBlockingError={blocking}
        isDirty={store.isDirty}
        isSaving={saveMutation.isPending}
        isSubmitting={submitMutation.isPending || saveMutation.isPending}
        onSave={handleSave}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

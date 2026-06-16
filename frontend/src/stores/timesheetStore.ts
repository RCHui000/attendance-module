import { create } from "zustand";
import type { TimesheetRow, OvertimeStore } from "@/types/timesheet";

interface TimesheetState {
  rows: TimesheetRow[];
  overtime: Record<string, OvertimeStore>; // "YYYY-MM-DD" -> overtime data
  remark: string;
  isDirty: boolean;

  // Actions
  initFromServer: (serverData: {
    entries: { project_id: number; work_date: string; hours: number; description?: string }[];
    overtime: { work_date: string; overtime_hours: number; reason?: string; status?: string; reject_comment?: string }[];
    projectStatuses?: { project_id: number; status: "draft" | "pending" | "approved" | "rejected" | "summary_pending"; assignee_role?: string; completed_at?: string }[];
    remark: string;
    weekDays: string[];
  }) => void;

  updatePercent: (rowIndex: number, day: string, value: number) => void;
  updateOvertime: (day: string, hours: number) => void;
  updateDescription: (rowIndex: number, day: string, value: string) => void;
  updateProject: (rowIndex: number, projectId: number) => void;
  setRemark: (remark: string) => void;
  addRow: () => void;
  ensureEmptyRow: (markDirty?: boolean) => void;
  ensureDraftProjectRow: () => void;
  removeRow: (rowIndex: number) => void;
  markClean: () => void;
  reset: () => void;
}

const createEmptyRow = (): TimesheetRow => ({
  projectId: 0,
  originalProjectId: 0,
  percents: {},
  descriptions: {},
});

export const useTimesheetStore = create<TimesheetState>((set, get) => ({
  rows: [],
  overtime: {},
  remark: "",
  isDirty: false,

  initFromServer: ({ entries, overtime, projectStatuses, remark, weekDays }) => {
    const statusMap = new Map((projectStatuses || []).map((item) => [Number(item.project_id), item]));
    // Group entries by project
    const projectMap = new Map<number, TimesheetRow>();
    for (const e of entries) {
      if (!projectMap.has(e.project_id)) {
        const projectStatus = statusMap.get(Number(e.project_id));
        projectMap.set(e.project_id, {
          projectId: e.project_id,
          originalProjectId: e.project_id,
          percents: {},
          descriptions: {},
          approvalStatus: projectStatus?.status || "draft",
          approvalRole: projectStatus?.assignee_role,
          approvedAt: projectStatus?.completed_at,
        });
      }
      const row = projectMap.get(e.project_id)!;
      row.percents[e.work_date] = Math.round(e.hours * 100);
      if (e.description) {
        row.descriptions[e.work_date] = e.description;
      }
    }
    for (const projectStatus of projectStatuses || []) {
      const projectId = Number(projectStatus.project_id);
      if (!projectId || projectMap.has(projectId)) continue;
      if (projectStatus.status !== "rejected") continue;
      projectMap.set(projectId, {
        projectId,
        originalProjectId: projectId,
        percents: {},
        descriptions: {},
        approvalStatus: projectStatus.status,
        approvalRole: projectStatus.assignee_role,
        approvedAt: projectStatus.completed_at,
      });
    }
    const rows = Array.from(projectMap.values());

    // Convert overtime array to record by date
    const overtimeRecord: Record<string, OvertimeStore> = {};
    for (const day of weekDays) {
      const ot = overtime.find((o) => o.work_date === day);
      overtimeRecord[day] = {
        hours: ot?.overtime_hours || 0,
        reason: ot?.reason || "",
        status: ot?.status || "pending",
        rejectComment: ot?.reject_comment || "",
      };
    }

    set({
      rows: rows.length === 0 ? [createEmptyRow()] : rows,
      overtime: overtimeRecord,
      remark,
      isDirty: false,
    });
  },

  updatePercent: (rowIndex, day, value) => {
    const rows = [...get().rows];
    rows[rowIndex] = {
      ...rows[rowIndex],
      percents: { ...rows[rowIndex].percents, [day]: value },
    };
    set({ rows, isDirty: true });
  },

  updateOvertime: (day, hours) => {
    set({
      overtime: {
        ...get().overtime,
        [day]: { ...get().overtime[day], hours },
      },
      isDirty: true,
    });
  },

  updateDescription: (rowIndex, day, value) => {
    const rows = [...get().rows];
    rows[rowIndex] = {
      ...rows[rowIndex],
      descriptions: { ...rows[rowIndex].descriptions, [day]: value },
      // apply to all days
    };
    // Apply description to all days for the row (matches original behavior)
    for (const d in rows[rowIndex].descriptions) {
      rows[rowIndex].descriptions[d] = value;
    }
    set({ rows, isDirty: true });
  },

  updateProject: (rowIndex, projectId) => {
    const rows = [...get().rows];
    rows[rowIndex] = { ...rows[rowIndex], projectId, originalProjectId: rows[rowIndex].originalProjectId || rows[rowIndex].projectId };
    set({ rows, isDirty: true });
  },

  setRemark: (remark) => set({ remark, isDirty: true }),

  addRow: () => {
    set({ rows: [...get().rows, createEmptyRow()], isDirty: true });
  },

  ensureEmptyRow: (markDirty = false) => {
    set({ rows: [...get().rows, createEmptyRow()], isDirty: markDirty || get().isDirty });
  },

  ensureDraftProjectRow: () => {
    const rows = get().rows;
    const hasDraftProjectRow = rows.some((row) => !row.projectId && !row.approvalStatus);
    if (!hasDraftProjectRow) {
      set({ rows: [...rows, createEmptyRow()], isDirty: get().isDirty });
    }
  },

  removeRow: (rowIndex) => {
    const rows = get().rows.filter((_, i) => i !== rowIndex);
    set({ rows: rows.length === 0 ? [createEmptyRow()] : rows, isDirty: true });
  },

  markClean: () => set({ isDirty: false }),
  reset: () => set({ rows: [], overtime: {}, remark: "", isDirty: false }),
}));

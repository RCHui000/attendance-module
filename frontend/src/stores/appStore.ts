import { create } from "zustand";
import { mondayOfWeek } from "@/utils/dates";

export type ViewType = "timesheet" | "dashboard" | "review" | "report" | "employees";

interface AppState {
  activeView: ViewType;
  setActiveView: (view: ViewType) => void;

  // Report state
  reportTab: "labor" | "projects";
  setReportTab: (tab: "labor" | "projects") => void;
  reportPeriodType: "month" | "quarter" | "year";
  setReportPeriodType: (type: "month" | "quarter" | "year") => void;
  reportYear: number;
  setReportYear: (year: number) => void;
  reportMonth: number;
  setReportMonth: (month: number) => void;
  reportQuarter: number;
  setReportQuarter: (quarter: number) => void;

  // Employee state
  employeeTab: "employee" | "management";
  setEmployeeTab: (tab: "employee" | "management") => void;
  selectedEmployeeId: number | null;
  setSelectedEmployeeId: (id: number | null) => void;
  editingEmployeeId: number | null;
  setEditingEmployeeId: (id: number | null) => void;

  // Organization state
  editingOrgId: number | null;
  setEditingOrgId: (id: number | null) => void;

  // Review state
  approvalTab: "pending" | "reviewed";
  setApprovalTab: (tab: "pending" | "reviewed") => void;

  // Project editing
  editingProjectId: number | null;
  setEditingProjectId: (id: number | null) => void;

  // Selected week for timesheet (shared with dashboard/report)
  currentWeek: string;
  setCurrentWeek: (week: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeView: "timesheet",
  setActiveView: (view) => set({ activeView: view }),

  reportTab: "labor",
  setReportTab: (tab) => set({ reportTab: tab }),
  reportPeriodType: "month",
  setReportPeriodType: (type) => set({ reportPeriodType: type }),
  reportYear: new Date().getFullYear(),
  setReportYear: (year) => set({ reportYear: year }),
  reportMonth: new Date().getMonth() + 1,
  setReportMonth: (month) => set({ reportMonth: month }),
  reportQuarter: Math.floor(new Date().getMonth() / 3) + 1,
  setReportQuarter: (quarter) => set({ reportQuarter: quarter }),

  employeeTab: "employee",
  setEmployeeTab: (tab) => set({ employeeTab: tab }),
  selectedEmployeeId: null,
  setSelectedEmployeeId: (id) => set({ selectedEmployeeId: id }),
  editingEmployeeId: null,
  setEditingEmployeeId: (id) => set({ editingEmployeeId: id }),

  editingOrgId: null,
  setEditingOrgId: (id) => set({ editingOrgId: id }),

  approvalTab: "pending",
  setApprovalTab: (tab) => set({ approvalTab: tab }),

  editingProjectId: null,
  setEditingProjectId: (id) => set({ editingProjectId: id }),

  currentWeek: mondayOfWeek(new Date().toISOString().slice(0, 10)),
  setCurrentWeek: (week) => set({ currentWeek: week }),
}));

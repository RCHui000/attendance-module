import { create } from "zustand";
import type { PeriodType } from "@/components/dashboard/periodUtils";
import { isoDate, timesheetPeriodStartOfDate } from "@/utils/dates";

export type ViewType = "timesheet" | "leave" | "dashboard" | "review" | "report" | "employees" | "apps";

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
  reviewPeriodType: PeriodType;
  setReviewPeriodType: (type: PeriodType) => void;
  reviewYear: number;
  setReviewYear: (year: number) => void;
  reviewMonth: number;
  setReviewMonth: (month: number) => void;
  reviewQuarter: number;
  setReviewQuarter: (quarter: number) => void;
  reviewWeekStart: string;
  setReviewWeekStart: (week: string) => void;

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
  reviewPeriodType: "quarter",
  setReviewPeriodType: (type) => set({ reviewPeriodType: type }),
  reviewYear: new Date().getFullYear(),
  setReviewYear: (year) => set({ reviewYear: year }),
  reviewMonth: new Date().getMonth() + 1,
  setReviewMonth: (month) => set({ reviewMonth: month }),
  reviewQuarter: Math.floor(new Date().getMonth() / 3) + 1,
  setReviewQuarter: (quarter) => set({ reviewQuarter: quarter }),
  reviewWeekStart: timesheetPeriodStartOfDate(isoDate(new Date())),
  setReviewWeekStart: (week) => set({ reviewWeekStart: week }),

  editingProjectId: null,
  setEditingProjectId: (id) => set({ editingProjectId: id }),

  currentWeek: timesheetPeriodStartOfDate(isoDate(new Date())),
  setCurrentWeek: (week) => set({ currentWeek: week }),
}));

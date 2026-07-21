import { lazy } from "react";

const pageLoaders = {
  login: () => import("@/pages/LoginPage"),
  timesheet: () => import("@/pages/TimesheetPage"),
  dashboard: () => import("@/pages/DashboardPage"),
  review: () => import("@/pages/ReviewPage"),
  report: () => import("@/pages/ReportPage"),
  employees: () => import("@/pages/EmployeesPage"),
  leave: () => import("@/pages/LeavePage"),
  apps: () => import("@/pages/AppsPage"),
} as const;

export type PageView = keyof typeof pageLoaders;

export function preloadPage(view: string): Promise<unknown> | undefined {
  return pageLoaders[view as PageView]?.();
}

export const LoginPage = lazy(pageLoaders.login);
export const TimesheetPage = lazy(pageLoaders.timesheet);
export const DashboardPage = lazy(pageLoaders.dashboard);
export const ReviewPage = lazy(pageLoaders.review);
export const ReportPage = lazy(pageLoaders.report);
export const EmployeesPage = lazy(pageLoaders.employees);
export const LeavePage = lazy(pageLoaders.leave);
export const AppsPage = lazy(pageLoaders.apps);

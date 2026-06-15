import { useEffect } from "react";
import type { ReactElement } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { APP_NAME } from "@/lib/constants";
import { useAuthStore } from "@/stores/authStore";
import { useRealtime } from "@/hooks/useRealtime";
import { AppLayout } from "@/components/layout/AppLayout";
import LoginPage from "@/pages/LoginPage";
import TimesheetPage from "@/pages/TimesheetPage";
import DashboardPage from "@/pages/DashboardPage";
import ReviewPage from "@/pages/ReviewPage";
import ReportPage from "@/pages/ReportPage";
import EmployeesPage from "@/pages/EmployeesPage";
import LeavePage from "@/pages/LeavePage";
import AppsPage from "@/pages/AppsPage";

function PermissionRoute({
  resource,
  children,
}: {
  resource: string;
  children: ReactElement;
}) {
  const { canAccess } = useAuthStore();
  if (!canAccess(resource)) return <Navigate to="/" replace />;
  return children;
}

function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-[#0f1115] text-white text-lg font-bold">
          PSA
        </div>
        <p className="text-sm text-muted-foreground">{APP_NAME} 加载中…</p>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { canAccess } = useAuthStore();
  useRealtime();

  const defaultRoute = canAccess("dashboard") ? "/dashboard" : "/timesheet";

  return (
    <AppLayout>
      <Routes>
        <Route index element={<Navigate to={defaultRoute} replace />} />
        <Route path="timesheet" element={<PermissionRoute resource="timesheet"><TimesheetPage /></PermissionRoute>} />
        <Route path="leave" element={<PermissionRoute resource="leave"><LeavePage /></PermissionRoute>} />
        <Route path="dashboard" element={<PermissionRoute resource="dashboard"><DashboardPage /></PermissionRoute>} />
        <Route path="review" element={<PermissionRoute resource="review"><ReviewPage /></PermissionRoute>} />
        <Route path="report" element={<PermissionRoute resource="report"><ReportPage /></PermissionRoute>} />
        <Route path="employees" element={<PermissionRoute resource="system_management"><EmployeesPage /></PermissionRoute>} />
        <Route path="apps" element={<PermissionRoute resource="apps"><AppsPage /></PermissionRoute>} />
      </Routes>
    </AppLayout>
  );
}

export default function App() {
  const { isAuthenticated, isLoading, checkSession } = useAuthStore();

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <AuthenticatedApp />;
}

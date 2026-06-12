import { useEffect } from "react";
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
  const { canReview } = useAuthStore();
  useRealtime();

  const defaultRoute = canReview ? "/dashboard" : "/timesheet";

  return (
    <AppLayout>
      <Routes>
        <Route index element={<Navigate to={defaultRoute} replace />} />
        <Route path="timesheet" element={<TimesheetPage />} />
        <Route path="leave" element={<LeavePage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="apps" element={<AppsPage />} />
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

import { Suspense, useEffect } from "react";
import type { ReactElement } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router";
import { APP_NAME } from "@/lib/constants";
import { getStoredToken } from "@/lib/authToken";
import { useAuthStore } from "@/stores/authStore";
import { useRealtime } from "@/hooks/useRealtime";
import { AppLayout } from "@/components/layout/AppLayout";
import { NAV_ITEMS } from "@/components/layout/navItems";
import {
  AppsPage,
  DashboardPage,
  EmployeesPage,
  LeavePage,
  LoginPage,
  ReportPage,
  ReviewPage,
  TimesheetPage,
  preloadPage,
} from "@/pageModules";

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

function RouteLoadingScreen() {
  return (
    <section aria-label="页面加载中" className="animate-pulse space-y-4 py-1">
      <div className="h-10 w-full rounded-md bg-muted/70" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 rounded-md bg-muted/60" />
        ))}
      </div>
      <div className="h-72 rounded-md bg-muted/50" />
    </section>
  );
}

function AuthenticatedApp() {
  const { canAccess } = useAuthStore();
  useRealtime();

  const defaultRoute = canAccess("dashboard") ? "/dashboard" : "/timesheet";

  useEffect(() => {
    void preloadPage(defaultRoute.slice(1));
  }, [defaultRoute]);

  useEffect(() => {
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType || "")) {
      return;
    }

    let idleId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      const preloadAccessiblePages = () => {
        NAV_ITEMS
          .filter((item) => canAccess(item.resource))
          .forEach((item) => void preloadPage(item.view));
      };
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(preloadAccessiblePages, { timeout: 2_000 });
      } else {
        preloadAccessiblePages();
      }
    }, 1_200);

    return () => {
      window.clearTimeout(timeoutId);
      if (idleId != null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [canAccess]);

  return (
    <AppLayout>
      <Suspense fallback={<RouteLoadingScreen />}>
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
      </Suspense>
    </AppLayout>
  );
}

export default function App() {
  const { isAuthenticated, isLoading, checkSession } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (!getStoredToken()) {
      void preloadPage("login");
      return;
    }

    const requestedPage = location.pathname.split("/").filter(Boolean)[0];
    if (requestedPage) {
      void preloadPage(requestedPage);
      return;
    }
    void preloadPage("dashboard");
    void preloadPage("timesheet");
  }, [location.pathname]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <LoginPage />
      </Suspense>
    );
  }

  return <AuthenticatedApp />;
}

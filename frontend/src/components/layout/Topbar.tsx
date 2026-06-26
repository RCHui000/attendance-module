import type { ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { SegmentedPill } from "@/components/ui/segmented-pill";
import { LayoutDashboard, TrendingUp } from "lucide-react";
import { PAGE_TITLES } from "./navItems";

type TopbarProps = {
  mobile?: boolean;
};

type DashboardTab = "overview" | "analytics";

const DASHBOARD_TAB_OPTIONS: { value: DashboardTab; label: string; icon: ReactNode }[] = [
  { value: "overview", label: "总览", icon: <LayoutDashboard className="size-3.5" /> },
  { value: "analytics", label: "分析", icon: <TrendingUp className="size-3.5" /> },
];

export function Topbar({ mobile = false }: TopbarProps) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const currentView = location.pathname.replace("/", "") || "timesheet";
  const pageTitle = PAGE_TITLES[currentView] || PAGE_TITLES.timesheet;
  const dashboardTab: DashboardTab = searchParams.get("tab") === "analytics" ? "analytics" : "overview";
  const showDashboardTabs = currentView === "dashboard" && !mobile;

  const updateDashboardTab = (tab: DashboardTab) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("tab", tab);
      return next;
    });
  };

  return (
    <header
      className={cn(
        "mb-4 flex items-center justify-between gap-3",
        mobile && "mb-3",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <h1
          className={cn(
            "font-semibold leading-tight text-foreground",
            mobile ? "min-w-0 truncate text-lg" : "text-xl",
          )}
        >
          {pageTitle}
        </h1>
        {showDashboardTabs && (
          <SegmentedPill
            value={dashboardTab}
            items={DASHBOARD_TAB_OPTIONS}
            onChange={updateDashboardTab}
            ariaLabel="看板视图切换"
          />
        )}
      </div>

      <div className="shrink-0" aria-hidden="true" />
    </header>
  );
}

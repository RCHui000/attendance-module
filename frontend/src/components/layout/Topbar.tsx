import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/stores/authStore";
import { LogOut } from "lucide-react";

const PAGE_TITLES: Record<string, string> = {
  timesheet: "我的周表",
  leave: "请假申请",
  dashboard: "数据看板",
  review: "审批中心",
  report: "项目列表",
  employees: "员工与组织",
  apps: "应用中心",
};

export function Topbar() {
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const currentView = location.pathname.replace("/", "") || "timesheet";
  const pageTitle = PAGE_TITLES[currentView] || PAGE_TITLES.timesheet;

  return (
    <header className="mb-4 flex items-center justify-between gap-3 max-[900px]:items-start">
      <h1 className="text-xl font-semibold leading-tight text-foreground">
        {pageTitle}
      </h1>

      <div className="flex shrink-0 items-center gap-3">
        {user && (
          <Badge
            variant="outline"
            className="h-7 rounded-pill border-border bg-white px-3 text-xs font-bold"
          >
            {user.name}
          </Badge>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={logout}
        >
          <LogOut className="mr-1 size-3.5" />
          退出
        </Button>
      </div>
    </header>
  );
}

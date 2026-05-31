import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/stores/authStore";
import { LogOut, KeyRound } from "lucide-react";

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  timesheet: { title: "我的周表", subtitle: "" },
  dashboard: { title: "经营与人力投入", subtitle: "按项目查看合同额、回款、人力成本、毛利和本周工日投入" },
  review: { title: "周表与加班 OT", subtitle: "审批中心" },
  report: { title: "项目列表", subtitle: "按时间跨度查看项目工日投入，或维护项目基础数据" },
  employees: { title: "员工与组织架构", subtitle: "管理员" },
};

export function Topbar() {
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const currentView = location.pathname.replace("/", "") || "timesheet";
  const pageInfo = PAGE_TITLES[currentView] || PAGE_TITLES.timesheet;

  return (
    <header className="flex items-start justify-between mb-8 max-[900px]:flex-col max-[900px]:gap-2">
      <div>
        {pageInfo.subtitle && (
          <span className="text-xs font-bold tracking-wider uppercase text-muted-foreground">
            {pageInfo.subtitle}
          </span>
        )}
        <h1 className="text-[32px] font-bold leading-[1.12] text-foreground mt-1">
          {pageInfo.title}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        {user && (
          <Badge
            variant="outline"
            className="rounded-pill text-xs font-bold h-7 px-3 border-border bg-white"
          >
            {user.name}
          </Badge>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => {
            // Password change will be implemented later with dialog
          }}
        >
          <KeyRound className="size-3.5 mr-1" />
          修改密码
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={logout}
        >
          <LogOut className="size-3.5 mr-1" />
          退出
        </Button>
      </div>
    </header>
  );
}

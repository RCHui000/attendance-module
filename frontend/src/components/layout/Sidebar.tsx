import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { APP_NAME, APP_VERSION } from "@/lib/constants";
import { useAuthStore } from "@/stores/authStore";
import {
  LayoutDashboard,
  ClipboardCheck,
  Calendar,
  FolderKanban,
  Users,
  CalendarX2,
  Grid3X3,
} from "lucide-react";

const NAV_ITEMS = [
  { view: "dashboard", label: "数据看板", icon: LayoutDashboard, requireReview: true, requireAdmin: false },
  { view: "review", label: "审批中心", icon: ClipboardCheck, requireReview: true, requireAdmin: false },
  { view: "timesheet", label: "我的周表", icon: Calendar, requireReview: false, requireAdmin: false },
  { view: "leave", label: "请假申请", icon: CalendarX2, requireReview: false, requireAdmin: false },
  { view: "report", label: "项目列表", icon: FolderKanban, requireReview: true, requireAdmin: false },
  { view: "employees", label: "员工与组织", icon: Users, requireReview: true, requireAdmin: false },
] as const;

const BOTTOM_NAV_ITEMS = [
  { view: "apps", label: "应用中心", icon: Grid3X3, requireReview: false, requireAdmin: false },
] as const;

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin, canReview } = useAuthStore();

  const currentView = location.pathname.replace("/", "") || "dashboard";

  const canSee = (item: { requireAdmin: boolean; requireReview: boolean }) => {
    if (item.requireAdmin && !isAdmin) return false;
    if (item.requireReview && !canReview) return false;
    return true;
  };

  const visibleItems = NAV_ITEMS.filter(canSee);
  const visibleBottomItems = BOTTOM_NAV_ITEMS.filter(canSee);

  return (
    <aside className="sticky top-0 h-screen w-[232px] shrink-0 flex flex-col bg-sidebar-bg py-3 px-4 max-[900px]:w-full max-[900px]:h-auto">
      {/* Brand */}
      <div className="mb-6 pb-6 border-b border-white/10 max-[900px]:pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/10 text-white text-base font-bold select-none">
            PSA
          </div>
          <div>
            <strong className="block text-sm text-white leading-tight">
              {APP_NAME}
            </strong>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-sidebar-muted">
              <span>版本{APP_VERSION}</span>
              <span>{user?.role ? roleLabel(user.role) : "内部管理"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="grid gap-1.5 max-[900px]:grid-cols-3">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
          <button
            key={item.view}
            type="button"
            className={cn(
              "w-full flex items-center gap-1.5 px-3 py-2 rounded-md text-sm transition-colors duration-160",
              "text-sidebar-text hover:text-white hover:bg-white/10",
              currentView === item.view &&
                "bg-white text-sidebar-bg font-medium hover:bg-white hover:text-sidebar-bg",
            )}
            onClick={() => navigate(`/${item.view}`)}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </button>
        )})}
      </nav>

      <nav className="mt-auto grid gap-1.5 max-[900px]:mt-3 max-[900px]:grid-cols-3">
        {visibleBottomItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.view}
              type="button"
              className={cn(
                "w-full flex items-center gap-1.5 px-3 py-2 rounded-md text-sm transition-colors duration-160",
                "text-sidebar-text hover:text-white hover:bg-white/10",
                currentView === item.view &&
                  "bg-white text-sidebar-bg font-medium hover:bg-white hover:text-sidebar-bg",
              )}
              onClick={() => navigate(`/${item.view}`)}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Separator */}
      <div className="mt-3 border-t border-white/10 max-[900px]:hidden" />

      {/* Logo — full width below the separator line, no padding */}
      <div className="-mx-4 max-[900px]:hidden">
        <img
          src="/logo/公司logo.png"
          alt="Logo"
          className="w-full object-contain opacity-90"
        />
      </div>

      {/* User info at bottom */}
      {user && (
        <div className="pt-2 pb-1 max-[900px]:hidden">
          <span className="text-xs text-sidebar-muted">
            {user.name} · {user.department || "—"}
          </span>
        </div>
      )}
    </aside>
  );
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    employee: "员工",
    manager: "主管",
    admin: "管理员",
  };
  return map[role] || role;
}

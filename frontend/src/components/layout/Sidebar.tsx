import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { APP_NAME, APP_VERSION } from "@/lib/constants";
import { useAuthStore } from "@/stores/authStore";
import { NAV_ITEMS } from "./navItems";

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, canAccess, sidebarOrder } = useAuthStore();

  const currentView = location.pathname.replace("/", "") || "dashboard";

  const visibleItems = NAV_ITEMS
    .filter((item) => canAccess(item.resource))
    .sort((a, b) => (sidebarOrder[a.resource] || a.order) - (sidebarOrder[b.resource] || b.order));

  return (
    <aside className="sticky top-0 flex h-screen w-[216px] shrink-0 flex-col bg-sidebar-bg px-3 py-3 max-[1179px]:w-16 max-[1179px]:px-2">
      {/* Brand */}
      <div className="mb-6 border-b border-white/10 pb-6 max-[1179px]:mb-4 max-[1179px]:pb-4">
        <div className="flex items-center gap-2.5 max-[1179px]:justify-center">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/10 text-white text-base font-bold select-none">
            PSA
          </div>
          <div className="min-w-0 max-[1179px]:sr-only">
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
      <nav className="grid gap-1.5">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
          <button
            key={item.id}
            type="button"
            title={item.label}
            aria-label={item.label}
            className={cn(
              "group relative flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors duration-160",
              "max-[1179px]:mx-auto max-[1179px]:size-10 max-[1179px]:justify-center max-[1179px]:px-0",
              "text-sidebar-text hover:text-white hover:bg-white/10",
              currentView === item.view &&
                "bg-white text-sidebar-bg font-medium hover:bg-white hover:text-sidebar-bg",
            )}
            onClick={() => navigate(`/${item.view}`)}
          >
            <Icon className="size-4 shrink-0 max-[1179px]:size-4.5" />
            <span className="min-w-0 truncate max-[1179px]:sr-only">{item.label}</span>
            <span
              className={cn(
                "pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs shadow-lg transition-opacity",
                "max-[1179px]:block max-[1179px]:opacity-0 max-[1179px]:group-hover:opacity-100 max-[1179px]:group-focus-visible:opacity-100",
                currentView === item.view ? "bg-white text-sidebar-bg" : "bg-sidebar-bg text-white",
              )}
            >
              {item.label}
            </span>
          </button>
        )})}
      </nav>

      {/* Separator */}
      <div className="mt-auto border-t border-white/10 max-[1179px]:hidden" />

      {/* Logo — full width below the separator line, no padding */}
      <div className="-mx-3 max-[1179px]:hidden">
        <img
          src="/logo/公司logo.png"
          alt="Logo"
          className="w-full object-contain opacity-90"
        />
      </div>

      {/* User info at bottom */}
      {user && (
        <div className="pb-1 pt-2 max-[1179px]:hidden">
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
    lead: "基层负责人",
    manager: "主管",
    director: "董事",
    admin: "管理员",
  };
  return map[role] || role;
}

import { useLocation, useNavigate } from "react-router-dom";
import { APP_NAME, APP_VERSION } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { SidebarSettingsMenu } from "./SidebarSettingsMenu";
import { NAV_ITEMS } from "./navItems";

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { canAccess, sidebarOrder, logout, user } = useAuthStore();

  const currentView = location.pathname.replace("/", "") || "dashboard";
  const visibleItems = NAV_ITEMS
    .filter((item) => canAccess(item.resource))
    .sort((a, b) => (sidebarOrder[a.resource] || a.order) - (sidebarOrder[b.resource] || b.order));

  return (
    <aside className="sticky top-0 flex h-screen w-[216px] shrink-0 flex-col bg-sidebar-bg px-3 py-3 max-[1179px]:w-16 max-[1179px]:px-2">
      <div className="mb-6 border-b border-white/10 pb-6 max-[1179px]:mb-4 max-[1179px]:pb-4">
        <div className="flex items-center gap-2.5 max-[1179px]:justify-center">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/10 text-base font-bold text-white select-none">
            PSA
          </div>
          <div className="min-w-0 max-[1179px]:sr-only">
            <strong className="block text-sm leading-tight text-white">{APP_NAME}</strong>
            <div className="mt-0.5 text-xs text-sidebar-muted">版本{APP_VERSION}</div>
          </div>
        </div>
      </div>

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
                "group relative flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-white/25 focus-visible:outline-none motion-reduce:transition-none",
                "max-[1179px]:mx-auto max-[1179px]:size-10 max-[1179px]:justify-center max-[1179px]:px-0",
                "text-sidebar-text hover:bg-white/10 hover:text-white",
                currentView === item.view &&
                  "bg-white font-medium text-sidebar-bg hover:bg-white hover:text-sidebar-bg",
              )}
              aria-current={currentView === item.view ? "page" : undefined}
              onClick={() => navigate(`/${item.view}`)}
            >
              <Icon className="size-4 shrink-0 max-[1179px]:size-4.5" />
              <span className="min-w-0 truncate max-[1179px]:sr-only">{item.label}</span>
              <span
                className={cn(
                  "pointer-events-none absolute top-1/2 left-[calc(100%+0.5rem)] z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs shadow-lg transition-opacity",
                  "max-[1179px]:block max-[1179px]:opacity-0 max-[1179px]:group-hover:opacity-100 max-[1179px]:group-focus-visible:opacity-100",
                  currentView === item.view ? "bg-white text-sidebar-bg" : "bg-sidebar-bg text-white",
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/10 max-[1179px]:hidden" />

      <div className="-mx-3 max-[1179px]:hidden">
        <img src="/logo/公司logo.png" alt="Logo" className="w-full object-contain opacity-90" />
      </div>

      <div className="mt-3 grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1.5 max-[1179px]:flex max-[1179px]:justify-center max-[1179px]:border-transparent max-[1179px]:bg-transparent max-[1179px]:px-0">
        <div className="flex min-w-0 items-center justify-center gap-1.5 text-center text-xs leading-none max-[1179px]:sr-only">
          <span className="min-w-0 truncate font-medium text-white">{user?.name || "未登录用户"}</span>
          <span className="shrink-0 text-sidebar-muted/60">·</span>
          <span className="min-w-0 truncate text-sidebar-muted">{user?.department || "未分配部门"}</span>
        </div>
        <SidebarSettingsMenu
          userName={user?.name || "未登录用户"}
          department={user?.department || "未分配部门"}
          onLogout={logout}
        />
      </div>
    </aside>
  );
}

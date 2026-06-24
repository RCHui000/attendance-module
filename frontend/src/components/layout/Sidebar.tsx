import { useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { APP_NAME, APP_VERSION } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { LogOut, Settings } from "lucide-react";
import { ThemeSettingsDialog } from "./ThemeSettingsDialog";
import { NAV_ITEMS } from "./navItems";

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { canAccess, sidebarOrder, logout } = useAuthStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

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

      <div className="mt-3 grid grid-cols-2 gap-2 max-[1179px]:grid-cols-1">
        <SidebarActionButton label="设置" onClick={() => setSettingsOpen(true)}>
          <Settings className="size-4" />
        </SidebarActionButton>
        <SidebarActionButton label="退出" onClick={logout}>
          <LogOut className="size-4" />
        </SidebarActionButton>
      </div>

      <ThemeSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </aside>
  );
}

function SidebarActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="mx-auto rounded-full border border-white/10 bg-white/5 text-sidebar-text hover:bg-white/10 hover:text-white focus-visible:ring-white/25"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

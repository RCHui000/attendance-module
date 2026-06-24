import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { NAV_ITEMS, type NavItem } from "./navItems";

const MOBILE_NAV_ORDER = ["review", "timesheet", "dashboard", "report"] as const;

export function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { canAccess } = useAuthStore();

  const currentView = location.pathname.replace("/", "") || "dashboard";
  const visibleItems = MOBILE_NAV_ORDER
    .map((id) => NAV_ITEMS.find((item) => item.id === id))
    .filter((item): item is NavItem => item != null && canAccess(item.resource));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(visibleItems.length, 1)}, minmax(0, 1fr))` }}
      >
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = currentView === item.view;

          return (
            <button
              key={item.id}
              type="button"
              className={cn(
                "flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[11px] font-medium leading-tight transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:transition-none",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              aria-current={active ? "page" : undefined}
              onClick={() => navigate(`/${item.view}`)}
            >
              <Icon className="size-4 shrink-0" />
              <span className="max-w-full truncate">{item.mobileLabel || item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

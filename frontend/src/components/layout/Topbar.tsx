import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { LogOut } from "lucide-react";
import { PAGE_TITLES } from "./navItems";

type TopbarProps = {
  mobile?: boolean;
};

export function Topbar({ mobile = false }: TopbarProps) {
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const currentView = location.pathname.replace("/", "") || "timesheet";
  const pageTitle = PAGE_TITLES[currentView] || PAGE_TITLES.timesheet;

  return (
    <header
      className={cn(
        "mb-4 flex items-center justify-between gap-3",
        mobile && "mb-3",
      )}
    >
      <h1
        className={cn(
          "font-semibold leading-tight text-foreground",
          mobile ? "min-w-0 truncate text-lg" : "text-xl",
        )}
      >
        {pageTitle}
      </h1>

      <div className={cn("flex shrink-0 items-center", mobile ? "gap-1.5" : "gap-3")}>
        {user && (
          <Badge
            variant="outline"
            className={cn(
              "rounded-pill border-border bg-white text-xs font-bold",
              mobile ? "h-7 max-w-24 px-2" : "h-7 px-3",
            )}
          >
            <span className="truncate">{user.name}</span>
          </Badge>
        )}

        <Button
          variant="outline"
          size={mobile ? "icon-sm" : "sm"}
          className={cn(!mobile && "h-8")}
          onClick={logout}
          aria-label={mobile ? "退出" : undefined}
        >
          <LogOut className={cn("size-3.5", !mobile && "mr-1")} />
          {!mobile && "退出"}
        </Button>
      </div>
    </header>
  );
}

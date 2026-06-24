import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { PAGE_TITLES } from "./navItems";

type TopbarProps = {
  mobile?: boolean;
};

export function Topbar({ mobile = false }: TopbarProps) {
  const location = useLocation();

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

      <div className="shrink-0" aria-hidden="true" />
    </header>
  );
}

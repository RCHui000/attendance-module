import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTheme } from "next-themes";
import { Check, ChevronRight, LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  isPointerInsideSubmenuGraceArea,
  type PointerPoint,
  type SubmenuGraceBounds,
} from "./sidebarMenuGeometry";

const themeOptions = [
  { value: "light", label: "明亮", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "自动", icon: Monitor },
] as const;

type ThemeValue = (typeof themeOptions)[number]["value"];

interface SidebarSettingsMenuProps {
  userName: string;
  department: string;
  onLogout: () => void;
}

export function SidebarSettingsMenu({
  userName,
  department,
  onLogout,
}: SidebarSettingsMenuProps) {
  const { theme, setTheme } = useTheme();
  const activeTheme = (theme || "system") as ThemeValue;
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const previousPointerRef = useRef<PointerPoint | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const identityLabel = department ? `${userName} / ${department}` : userName;

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const clearMenuCloseTimer = () => {
    if (menuCloseTimerRef.current) {
      clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setThemeOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setThemeOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(
    () => () => {
      clearCloseTimer();
      clearMenuCloseTimer();
    },
    [],
  );

  const submenuBounds = (): SubmenuGraceBounds | null => {
    const rect = submenuRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { left: rect.left, top: rect.top, bottom: rect.bottom };
  };

  const scheduleThemeClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setThemeOpen(false), 220);
  };

  const scheduleMenuClose = () => {
    clearMenuCloseTimer();
    menuCloseTimerRef.current = setTimeout(() => {
      setOpen(false);
      setThemeOpen(false);
    }, 160);
  };

  const handlePointerMove = (event: ReactMouseEvent) => {
    previousPointerRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleMenuPointerLeave = (event: ReactMouseEvent) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && submenuRef.current?.contains(nextTarget)) return;

    const current = { x: event.clientX, y: event.clientY };
    const insideGraceArea = isPointerInsideSubmenuGraceArea({
      previous: previousPointerRef.current,
      current,
      submenu: submenuBounds(),
    });
    if (insideGraceArea) {
      scheduleThemeClose();
      return;
    }
    setThemeOpen(false);
  };

  const chooseTheme = (value: ThemeValue) => {
    setTheme(value);
    setThemeOpen(false);
    setOpen(false);
  };

  const logout = () => {
    setOpen(false);
    onLogout();
  };

  return (
    <div
      ref={rootRef}
      className="relative flex items-center justify-end"
      data-testid="sidebar-settings-root"
      onMouseEnter={() => {
        clearMenuCloseTimer();
        setOpen(true);
      }}
      onMouseLeave={scheduleMenuClose}
      onFocus={() => {
        clearMenuCloseTimer();
        setOpen(true);
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="rounded-full border border-white/10 bg-white/5 text-sidebar-text hover:bg-white/10 hover:text-white focus-visible:ring-white/25"
        aria-label={identityLabel ? `${identityLabel} · 设置` : "设置"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          clearMenuCloseTimer();
          setOpen(true);
        }}
      >
        <Settings className="size-4" />
      </Button>

      {open && (
        <div
          role="menu"
          data-testid="sidebar-settings-menu"
          className={cn(
            "absolute right-0 bottom-[calc(100%+0.5rem)] z-50 w-44 rounded-lg border border-border bg-white p-1.5 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10 dark:bg-[#11151c]",
            "max-[1179px]:bottom-0 max-[1179px]:left-[calc(100%+0.5rem)] max-[1179px]:right-auto",
          )}
          onMouseMove={handlePointerMove}
          onMouseEnter={() => {
            clearCloseTimer();
            clearMenuCloseTimer();
          }}
          onMouseLeave={handleMenuPointerLeave}
        >
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={themeOpen}
            className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            onMouseEnter={() => {
              clearCloseTimer();
              setThemeOpen(true);
            }}
            onClick={() => setThemeOpen((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setThemeOpen(true);
              }
            }}
          >
            <Sun className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">主题</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>

          <button
            type="button"
            role="menuitem"
            className="mt-1 flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-destructive transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none"
            onClick={logout}
          >
            <LogOut className="size-4" />
            <span>登出</span>
          </button>

          {themeOpen && (
            <div
              ref={submenuRef}
              role="menu"
              data-testid="sidebar-theme-submenu"
              className="absolute bottom-0 left-[calc(100%+0.5rem)] z-50 w-36 rounded-lg border border-border bg-white p-1.5 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10 dark:bg-[#11151c]"
              onMouseEnter={clearCloseTimer}
              onMouseLeave={(event) => {
                const nextTarget = event.relatedTarget as Node | null;
                if (nextTarget && rootRef.current?.contains(nextTarget)) return;
                setThemeOpen(false);
              }}
            >
              {themeOptions.map((option) => {
                const Icon = option.icon;
                const active = activeTheme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    onClick={() => chooseTheme(option.value)}
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1">{option.label}</span>
                    {active && <Check className="size-4 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

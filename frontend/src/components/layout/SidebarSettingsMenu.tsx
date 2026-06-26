import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
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

const menuSurfaceClass =
  "border-border bg-popover text-popover-foreground shadow-float ring-1 ring-foreground/10";
const menuItemClass =
  "flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-popover-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none";
const menuIconClass = "size-4 text-muted-foreground";

const MENU_WIDTH = 176;
const SUBMENU_WIDTH = 144;
const FLOAT_GAP = 8;
const VIEWPORT_PADDING = 8;
const ESTIMATED_MENU_HEIGHT = 96;
const ESTIMATED_SUBMENU_HEIGHT = 120;

type SubmenuSide = "left" | "right";

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

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
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ left: 0, top: 0 });
  const [submenuStyle, setSubmenuStyle] = useState<CSSProperties>({ left: 0, top: 0 });
  const [submenuSide, setSubmenuSide] = useState<SubmenuSide>("right");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
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

  const containsMenuNode = useCallback((target: Node | null) => {
    if (!target) return false;
    return Boolean(
      rootRef.current?.contains(target) ||
        menuRef.current?.contains(target) ||
        submenuRef.current?.contains(target),
    );
  }, []);

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuRect = menuRef.current?.getBoundingClientRect();
    const menuWidth = menuRect?.width || MENU_WIDTH;
    const menuHeight = menuRect?.height || ESTIMATED_MENU_HEIGHT;
    const collapsed = window.matchMedia("(max-width: 1179px)").matches;

    let left: number;
    let top: number;

    if (collapsed) {
      const rightSideLeft = rect.right + FLOAT_GAP;
      const canOpenRight = rightSideLeft + menuWidth <= viewportWidth - VIEWPORT_PADDING;
      left = canOpenRight ? rightSideLeft : rect.left - menuWidth - FLOAT_GAP;
      top = rect.top + rect.height - menuHeight;
    } else {
      left = rect.right - menuWidth;
      top = rect.top - menuHeight - FLOAT_GAP;
    }

    setMenuStyle({
      left: clamp(left, VIEWPORT_PADDING, viewportWidth - menuWidth - VIEWPORT_PADDING),
      top: clamp(top, VIEWPORT_PADDING, viewportHeight - menuHeight - VIEWPORT_PADDING),
    });
  }, []);

  const updateSubmenuPosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const menuRect = menu.getBoundingClientRect();
    const submenuRect = submenuRef.current?.getBoundingClientRect();
    const submenuWidth = submenuRect?.width || SUBMENU_WIDTH;
    const submenuHeight = submenuRect?.height || ESTIMATED_SUBMENU_HEIGHT;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rightLeft = menuRect.right + FLOAT_GAP;
    const canOpenRight = rightLeft + submenuWidth <= viewportWidth - VIEWPORT_PADDING;
    const side: SubmenuSide = canOpenRight ? "right" : "left";
    const left = side === "right" ? rightLeft : menuRect.left - submenuWidth - FLOAT_GAP;
    const top = menuRect.bottom - submenuHeight;

    setSubmenuSide(side);
    setSubmenuStyle({
      left: clamp(left, VIEWPORT_PADDING, viewportWidth - submenuWidth - VIEWPORT_PADDING),
      top: clamp(top, VIEWPORT_PADDING, viewportHeight - submenuHeight - VIEWPORT_PADDING),
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containsMenuNode(event.target as Node)) {
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
  }, [containsMenuNode, open]);

  useLayoutEffect(() => {
    if (!open) return;

    updateMenuPosition();
    if (themeOpen) updateSubmenuPosition();

    const frame = requestAnimationFrame(() => {
      updateMenuPosition();
      if (themeOpen) updateSubmenuPosition();
    });

    return () => cancelAnimationFrame(frame);
  }, [open, themeOpen, updateMenuPosition, updateSubmenuPosition]);

  useEffect(() => {
    if (!open) return undefined;

    const updatePosition = () => {
      updateMenuPosition();
      if (themeOpen) updateSubmenuPosition();
    };

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, themeOpen, updateMenuPosition, updateSubmenuPosition]);

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
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, side: submenuSide };
  };

  const scheduleThemeClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setThemeOpen(false), 220);
  };

  const scheduleMenuClose = (delay = 160) => {
    clearMenuCloseTimer();
    menuCloseTimerRef.current = setTimeout(() => {
      setOpen(false);
      setThemeOpen(false);
    }, delay);
  };

  const handlePointerMove = (event: ReactMouseEvent) => {
    previousPointerRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleMenuPointerLeave = (event: ReactMouseEvent) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (containsMenuNode(nextTarget)) return;

    const current = { x: event.clientX, y: event.clientY };
    const insideGraceArea = isPointerInsideSubmenuGraceArea({
      previous: previousPointerRef.current,
      current,
      submenu: submenuBounds(),
    });
    if (insideGraceArea) {
      scheduleThemeClose();
      scheduleMenuClose(280);
      return;
    }
    setThemeOpen(false);
    scheduleMenuClose();
  };

  const handleRootPointerLeave = (event: ReactMouseEvent) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (containsMenuNode(nextTarget)) return;
    scheduleMenuClose();
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

  const canPortal = typeof document !== "undefined";

  const menu = open && canPortal
    ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          data-testid="sidebar-settings-menu"
          className={cn(
            "fixed z-popover isolate w-44 rounded-lg p-1.5 text-sm",
            menuSurfaceClass,
          )}
          style={menuStyle}
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
            className={menuItemClass}
            onMouseEnter={() => {
              clearCloseTimer();
              clearMenuCloseTimer();
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
            <Sun className={menuIconClass} />
            <span className="min-w-0 flex-1">主题</span>
            <ChevronRight className={menuIconClass} />
          </button>

          <button
            type="button"
            role="menuitem"
            className="mt-1 flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-red-600 transition-colors hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none dark:text-red-300 dark:hover:bg-red-500/15 dark:focus-visible:bg-red-500/15"
            onClick={logout}
          >
            <LogOut className="size-4" />
            <span>登出</span>
          </button>
        </div>,
        document.body,
      )
    : null;

  const themeMenu = themeOpen && canPortal
    ? createPortal(
        <div
          ref={submenuRef}
          role="menu"
          data-testid="sidebar-theme-submenu"
          className={cn(
            "fixed z-popover isolate w-36 rounded-lg p-1.5 text-sm",
            menuSurfaceClass,
          )}
          style={submenuStyle}
          onMouseEnter={() => {
            clearCloseTimer();
            clearMenuCloseTimer();
          }}
          onMouseLeave={(event) => {
            const nextTarget = event.relatedTarget as Node | null;
            if (containsMenuNode(nextTarget)) return;
            setThemeOpen(false);
            scheduleMenuClose();
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
                className={menuItemClass}
                onClick={() => chooseTheme(option.value)}
              >
                <Icon className={menuIconClass} />
                <span className="min-w-0 flex-1">{option.label}</span>
                {active && <Check className="size-4 text-primary" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      ref={rootRef}
      className="relative flex items-center justify-end"
      data-testid="sidebar-settings-root"
      onMouseEnter={() => {
        clearMenuCloseTimer();
        setOpen(true);
      }}
      onMouseLeave={handleRootPointerLeave}
      onFocus={() => {
        clearMenuCloseTimer();
        setOpen(true);
      }}
    >
      <Button
        ref={buttonRef}
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
      {menu}
      {themeMenu}
    </div>
  );
}

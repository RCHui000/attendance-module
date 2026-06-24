import { useTheme } from "next-themes";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const themeOptions = [
  { value: "light", label: "明亮", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "自动", icon: Monitor },
] as const;

interface ThemeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ThemeSettingsDialog({ open, onOpenChange }: ThemeSettingsDialogProps) {
  const { theme, setTheme } = useTheme();
  const activeTheme = theme || "system";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>选择界面主题偏好。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const active = activeTheme === option.value;
            return (
              <Button
                key={option.value}
                type="button"
                variant={active ? "default" : "outline"}
                className={cn("h-9 justify-start rounded-full px-3", active && "shadow-sm")}
                onClick={() => setTheme(option.value)}
              >
                <Icon className="size-4" />
                <span className="ml-1.5">{option.label}</span>
                {active && <Check className="ml-auto size-4" />}
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

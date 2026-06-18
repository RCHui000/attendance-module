import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import type { Employee } from "@/types/employee";

interface ReminderFloatProps {
  employees: Employee[];
}

interface Reminder {
  level: "warn" | "danger";
  title: string;
  meta: string;
}

export function ReminderFloat({ employees }: ReminderFloatProps) {
  const [open, setOpen] = useState(false);

  const reminders = useMemo(() => {
    const list: Reminder[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const emp of employees) {
      if (emp.id === 0) continue;
      const name = emp.name || emp.employee_no || "未命名员工";

      if (emp.contract_end) {
        const end = new Date(emp.contract_end);
        const daysLeft = Math.ceil((end.getTime() - today.getTime()) / 86400000);
        if (daysLeft < 0) {
          list.push({
            level: "danger",
            title: `${name} 合同已到期`,
            meta: emp.contract_end,
          });
        } else if (daysLeft <= 30) {
          list.push({
            level: "warn",
            title: `${name} 合同 ${daysLeft} 天后到期`,
            meta: emp.contract_end,
          });
        }
      }
    }
    return list.slice(0, 8);
  }, [employees]);

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
        {reminders.length > 0 ? `提醒 (${reminders.length})` : "提醒"}
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="absolute right-0 top-full z-50 mt-1 w-[340px] rounded-lg border border-border bg-card shadow-float">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <strong className="text-sm">提醒事项</strong>
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0"
                onClick={() => setOpen(false)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            <div className="grid max-h-[320px] gap-1.5 overflow-auto p-2">
              {reminders.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  暂无提醒事项
                </div>
              ) : (
                reminders.map((reminder, index) => (
                  <div
                    key={index}
                    className={cn(
                      "rounded-md border-l-[3px] px-3 py-2 text-sm",
                      reminder.level === "danger"
                        ? "border-l-destructive bg-red-50"
                        : "border-l-warning bg-orange-50",
                    )}
                  >
                    <strong
                      className={cn(
                        "text-sm",
                        reminder.level === "danger"
                          ? "text-destructive"
                          : "text-warning",
                      )}
                    >
                      {reminder.title}
                    </strong>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {reminder.meta}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useTimesheetDetail } from "@/hooks/useApprovals";
import { statusText } from "@/lib/constants";
import { X } from "lucide-react";

interface ReviewDrawerProps {
  timesheetId: number | null;
  open: boolean;
  onClose: () => void;
}

export function ReviewDrawer({ timesheetId, open, onClose }: ReviewDrawerProps) {
  const { data, isLoading } = useTimesheetDetail(
    open ? timesheetId : null,
  );

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[520px] sm:max-w-[520px] p-0">
        {isLoading && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            加载中…
          </div>
        )}
        {data && (
          <div className="flex flex-col h-full">
            {/* Header */}
            <SheetHeader className="px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <SheetTitle className="text-lg">
                    {data.user_name} · {data.department || "—"}
                  </SheetTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {data.week_start_date} 至{" "}
                    {data.days?.[data.days.length - 1]}
                    {" · "}
                    <Badge
                      variant={
                        data.status === "approved"
                          ? "success"
                          : data.status === "rejected"
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {statusText[data.status] || data.status}
                    </Badge>
                  </p>
                </div>
              </div>
            </SheetHeader>

            {/* Body */}
            <div className="flex-1 overflow-auto px-5 py-4">
              {/* Daily breakdown table */}
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-xs font-bold text-muted-foreground">
                      项目
                    </th>
                    {data.days?.map((day) => (
                      <th
                        key={day}
                        className="text-center py-2 text-xs font-bold text-muted-foreground"
                      >
                        {day.slice(5)}
                      </th>
                    ))}
                    <th className="text-right py-2 text-xs font-bold text-muted-foreground">
                      合计
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* Group entries by project */}
                  {(() => {
                    const projectMap = new Map<
                      number,
                      { name: string; days: Record<string, number> }
                    >();
                    data.entries?.forEach((e) => {
                      if (!projectMap.has(e.project_id)) {
                        projectMap.set(e.project_id, {
                          name: e.project_name || `项目 #${e.project_id}`,
                          days: {},
                        });
                      }
                      const p = projectMap.get(e.project_id)!;
                      p.days[e.work_date] =
                        (p.days[e.work_date] || 0) + e.hours;
                    });
                    // Convert to array and add totals
                    return Array.from(projectMap.entries()).map(([pid, p]) => {
                      const dayValues = (data.days || []).map(
                        (d) => p.days[d] || 0,
                      );
                      const total = dayValues.reduce((a, b) => a + b, 0);
                      return (
                        <tr key={pid} className="border-b border-border/50">
                          <td className="py-2 text-sm font-medium">{p.name}</td>
                          {dayValues.map((v, i) => (
                            <td
                              key={i}
                              className="py-2 text-center tabular-nums"
                            >
                              {v > 0 ? (v * 100).toFixed(0) + "%" : "—"}
                            </td>
                          ))}
                          <td className="py-2 text-right tabular-nums font-medium">
                            {total.toFixed(1)}
                          </td>
                        </tr>
                      );
                    });
                  })()}

                  {/* Daily totals row */}
                  <tr className="border-t-2 border-border">
                    <td className="py-2 text-sm font-bold text-muted-foreground">
                      每日合计
                    </td>
                    {(data.days || []).map((day, i) => {
                      const sum = (data.entries || [])
                        .filter((e) => e.work_date === day)
                        .reduce((a, e) => a + e.hours, 0);
                      return (
                        <td
                          key={i}
                          className={`py-2 text-center tabular-nums font-bold ${
                            sum > 1 ? "text-destructive" : ""
                          }`}
                        >
                          {sum.toFixed(1)}
                        </td>
                      );
                    })}
                    <td className="py-2 text-right tabular-nums font-bold">
                      {(data.entries || [])
                        .reduce((a, e) => a + e.hours, 0)
                        .toFixed(1)}
                    </td>
                  </tr>

                  {/* Overtime row */}
                  <tr>
                    <td className="py-2 text-sm font-bold text-warning">
                      加班 OT
                    </td>
                    {(data.days || []).map((day, i) => {
                      const ot = (data.overtime || []).find(
                        (o) => o.work_date === day,
                      );
                      return (
                        <td
                          key={i}
                          className="py-2 text-center tabular-nums text-warning"
                        >
                          {ot ? ot.overtime_hours : "—"}
                        </td>
                      );
                    })}
                    <td className="py-2 text-right tabular-nums font-bold text-warning">
                      {(data.overtime || [])
                        .reduce((a, o) => a + (o.overtime_hours || 0), 0)
                        .toFixed(1)}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Remark */}
              {data.remark && (
                <>
                  <Separator className="my-3" />
                  <div className="text-sm">
                    <strong className="text-muted-foreground">备注：</strong>
                    <span>{data.remark}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

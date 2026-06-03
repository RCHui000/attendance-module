import { memo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { dayNames, holidayInfo } from "@/lib/constants";
import type { TimesheetRow, OvertimeStore, TimesheetStatus } from "@/types/timesheet";
import type { ProjectBrief } from "@/types/auth";
import { Plus, X } from "lucide-react";

interface TimesheetTableProps {
  rows: TimesheetRow[];
  overtime: Record<string, OvertimeStore>;
  weekDays: string[];
  projects: ProjectBrief[];
  status: TimesheetStatus;
  isLocked: boolean;
  dayTotals: Record<string, number>;
  onUpdatePercent: (rowIndex: number, day: string, value: number) => void;
  onUpdateOvertime: (day: string, hours: number) => void;
  onUpdateDescription: (rowIndex: number, day: string, value: string) => void;
  onUpdateProject: (rowIndex: number, projectId: number) => void;
  onAddRow: () => void;
  onRemoveRow: (rowIndex: number) => void;
}

function PercentCell({
  value,
  onChange,
  locked,
  invalid,
}: {
  value: number;
  onChange: (v: number) => void;
  locked: boolean;
  invalid: boolean;
}) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseInt(e.target.value) || 0;
      onChange(Math.max(0, Math.min(100, v)));
    },
    [onChange],
  );

  return (
    <div className="flex items-center gap-1.5 w-[90px]">
      <Input
        type="number"
        min="0"
        max="100"
        step="1"
        className={cn(
          "h-8 w-[72px] text-right text-sm",
          invalid && "border-destructive bg-red-50",
        )}
        value={value || ""}
        onChange={handleChange}
        disabled={locked}
        placeholder="0"
      />
      <span className="text-sm text-muted-foreground w-[18px]">%</span>
    </div>
  );
}

function HolidayBadge({ day }: { day: string }) {
  const info = holidayInfo[day];
  if (!info) return null;
  return (
    <span
      className={cn(
        "inline-block rounded-pill px-1.5 py-0 text-[11px] font-semibold leading-tight",
        info.type === "rest"
          ? "bg-[#fee2e2] text-destructive"
          : "bg-[#ffedd5] text-warning",
      )}
    >
      {info.name}
    </span>
  );
}

function DayHeader({ day, index }: { day: string; index: number }) {
  const date = new Date(day);
  const dayOfWeek = date.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isRest = holidayInfo[day]?.type === "rest";
  const isWork = holidayInfo[day]?.type === "work";

  return (
    <th className="w-[90px] text-center p-1.5">
      <strong
        className={cn(
          "block text-sm leading-tight",
          (isWeekend || isRest) && !isWork && "text-destructive",
          isWork && "text-warning",
        )}
      >
        {dayNames[index]}
      </strong>
      <span
        className={cn(
          "block text-xs text-muted-foreground leading-tight",
          (isWeekend || isRest) && !isWork && "text-destructive",
          isWork && "text-warning",
        )}
      >
        {day.slice(5)}
      </span>
      <HolidayBadge day={day} />
    </th>
  );
}

export const TimesheetTable = memo(function TimesheetTable({
  rows,
  overtime,
  weekDays,
  projects,
  isLocked,
  dayTotals,
  onUpdatePercent,
  onUpdateOvertime,
  onUpdateDescription,
  onUpdateProject,
  onAddRow,
  onRemoveRow,
}: TimesheetTableProps) {
  return (
    <div className="rounded-lg border border-border shadow-app overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-table-header border-b border-border">
              <th className="sticky left-0 bg-table-header z-10 w-[160px] min-w-[140px] p-1.5 text-left text-xs font-bold text-muted-foreground">
                项目
                {!isLocked && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-1 size-8 p-0"
                    onClick={onAddRow}
                    title="添加项目"
                  >
                    <Plus className="size-4" />
                  </Button>
                )}
              </th>
              {weekDays.map((day, i) => (
                <DayHeader key={day} day={day} index={i} />
              ))}
              <th className="w-[70px] p-1.5 text-center text-xs font-bold text-muted-foreground">
                周合计
              </th>
              <th className="w-[100px] p-1.5 text-center text-xs font-bold text-muted-foreground">
                备注
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const rowTotal = weekDays.reduce(
                (s, d) => s + (row.percents[d] || 0) / 100,
                0,
              );
              return (
                <tr key={ri} className="border-b border-border/50 hover:bg-row-hover">
                  <td className="sticky left-0 bg-white p-1.5 z-[5]">
                    <div className="flex items-center gap-1">
                      <Select
                        value={row.projectId ? String(row.projectId) : ""}
                        onValueChange={(v) =>
                          onUpdateProject(ri, Number(v))
                        }
                        disabled={isLocked}
                      >
                        <SelectTrigger className="h-8 text-sm flex-1 min-w-0">
                          <SelectValue placeholder="选择项目">
                            {(() => {
                              const sel = projects.find(
                                (p) => p.id === row.projectId,
                              );
                              return sel
                                ? `${sel.code} - ${sel.name}`
                                : null;
                            })()}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {projects.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {p.code} - {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!isLocked && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="size-8 p-0 shrink-0"
                          onClick={() => onRemoveRow(ri)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>

                  {weekDays.map((day) => (
                    <td key={day} className="p-1.5">
                      <PercentCell
                        value={row.percents[day] || 0}
                        onChange={(v) => onUpdatePercent(ri, day, v)}
                        locked={isLocked}
                        invalid={dayTotals[day] > 100}
                      />
                    </td>
                  ))}

                  <td className="p-1.5 text-center">
                    <span
                      className={cn(
                        "text-sm font-bold tabular-nums",
                        rowTotal > 1 && "text-destructive",
                      )}
                    >
                      {rowTotal.toFixed(1)}
                    </span>
                  </td>

                  <td className="p-1.5">
                    <Textarea
                      className="h-8 text-sm resize-none"
                      value={
                        row.descriptions.__row ||
                        Object.values(row.descriptions).find(
                          (d) => d?.trim(),
                        ) || ""
                      }
                      onChange={(e) =>
                        onUpdateDescription(ri, "__row", e.target.value)
                      }
                      disabled={isLocked}
                      placeholder="备注"
                    />
                  </td>
                </tr>
              );
            })}

            {/* Daily Totals Row */}
            <tr className="border-t-2 border-border bg-[#fafafa]">
              <td className="sticky left-0 bg-[#fafafa] p-1.5 text-sm font-bold text-muted-foreground z-[5]">
                每日合计
              </td>
              {weekDays.map((day) => (
                <td key={day} className="p-1.5 text-center">
                  <span
                    className={cn(
                      "text-sm font-bold tabular-nums",
                      dayTotals[day] > 100 && "text-destructive",
                    )}
                  >
                    {dayTotals[day]}%
                  </span>
                </td>
              ))}
              <td className="p-1.5 text-center">
                <span className="text-sm font-bold tabular-nums">
                  {weekDays
                    .reduce((s, d) => s + Math.min(dayTotals[d], 100) / 100, 0)
                    .toFixed(1)}
                </span>
              </td>
              <td />
            </tr>

            {/* Overtime Row */}
            <tr className="border-b border-border/50">
              <td className="sticky left-0 bg-white p-1.5 text-sm font-bold text-warning z-[5]">
                加班 OT
              </td>
              {weekDays.map((day) => (
                <td key={day} className="p-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    className="h-8 w-[72px] mx-auto text-right text-sm text-warning"
                    value={overtime[day]?.hours || ""}
                    onChange={(e) =>
                      onUpdateOvertime(
                        day,
                        parseFloat(e.target.value) || 0,
                      )
                    }
                    disabled={isLocked}
                    placeholder="0"
                  />
                </td>
              ))}
              <td className="p-1.5 text-center">
                <span className="text-sm font-bold tabular-nums text-warning">
                  {weekDays
                    .reduce((s, d) => s + (overtime[d]?.hours || 0), 0)
                    .toFixed(1)}
                </span>
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
});

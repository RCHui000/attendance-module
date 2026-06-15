import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { dayNames, holidayInfo } from "@/lib/constants";
import { formatWorkdays, MAX_REGULAR_WEEK_WORKDAYS } from "@/utils/validation";
import type { TimesheetRow, OvertimeStore, TimesheetStatus } from "@/types/timesheet";
import type { ProjectBrief } from "@/types/auth";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Plus,
  Search,
  X,
  XCircle,
} from "lucide-react";

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

function RowApprovalStatus({
  status,
}: {
  status?: TimesheetRow["approvalStatus"];
}) {
  const config = {
    approved: {
      label: "已批准",
      icon: CheckCircle2,
      className: "text-status-approved-text bg-status-approved-bg",
    },
    summary_pending: {
      label: "待汇总",
      icon: CheckCircle2,
      className: "text-status-approved-text bg-status-approved-bg",
    },
    pending: {
      label: "审批中",
      icon: Clock3,
      className: "text-primary bg-primary/10",
    },
    rejected: {
      label: "已退回",
      icon: XCircle,
      className: "text-destructive bg-destructive/10",
    },
    draft: {
      label: "草稿",
      icon: Circle,
      className: "text-muted-foreground bg-muted",
    },
  }[status || "draft"];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex h-6 w-[72px] shrink-0 items-center justify-center gap-1 rounded-md text-[11px] font-medium",
        config.className,
      )}
      title={config.label}
    >
      <Icon className="size-3" />
      {config.label}
    </span>
  );
}

function ProjectPicker({
  projects,
  value,
  disabled,
  onChange,
}: {
  projects: ProjectBrief[];
  value?: number | null;
  disabled: boolean;
  onChange: (projectId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [popupStyle, setPopupStyle] = useState({
    top: 0,
    left: 0,
    width: 320,
  });
  const selected = projects.find((project) => project.id === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredProjects = useMemo(() => {
    if (!normalizedQuery) return projects;
    return projects.filter((project) => {
      const haystack = `${project.code} ${project.name}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, projects]);

  const updatePopupPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const width = Math.max(rect.width, 320);
    const left = Math.min(
      Math.max(rect.left, viewportPadding),
      window.innerWidth - width - viewportPadding,
    );
    setPopupStyle({
      top: rect.bottom + 4,
      left,
      width,
    });
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        setQuery("");
        requestAnimationFrame(updatePopupPosition);
      }
    },
    [updatePopupPosition],
  );

  const handleSelect = useCallback(
    (projectId: number) => {
      onChange(projectId);
      setOpen(false);
    },
    [onChange],
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popupRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    updatePopupPosition();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePopupPosition);
    window.addEventListener("scroll", updatePopupPosition, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePopupPosition);
      window.removeEventListener("scroll", updatePopupPosition, true);
    };
  }, [open, updatePopupPosition]);

  const popup = open
    ? createPortal(
        <div
          ref={popupRef}
          className="fixed z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
          style={{
            top: popupStyle.top,
            left: popupStyle.left,
            width: popupStyle.width,
          }}
        >
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索项目编号或名称"
                className="h-8 pl-8 text-sm"
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto p-1" role="listbox">
            {filteredProjects.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                没有匹配项目
              </div>
            ) : (
              filteredProjects.map((project) => {
                const active = project.id === value;
                return (
                  <button
                    key={project.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-[#eef6ff] focus-visible:bg-[#eef6ff] focus-visible:ring-2 focus-visible:ring-ring",
                      active && "bg-[#dbeafe] text-[#1e3a8a]",
                    )}
                    title={`${project.code} - ${project.name}`}
                    onClick={() => handleSelect(project.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {project.code}
                      </span>
                        <span
                          className={cn(
                            "block truncate text-xs text-muted-foreground",
                            active && "text-[#1e40af]",
                          )}
                        >
                          {project.name}
                        </span>
                    </span>
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className="h-8 flex-1 min-w-0 justify-between px-2 text-left font-normal"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={selected ? `${selected.code} - ${selected.name}` : "选择项目"}
        onClick={() => handleOpenChange(!open)}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            !selected && "text-muted-foreground",
          )}
        >
          {selected ? `${selected.code} - ${selected.name}` : "选择项目"}
        </span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </Button>
      {popup}
    </>
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
  status,
  isLocked,
  dayTotals,
  onUpdatePercent,
  onUpdateOvertime,
  onUpdateDescription,
  onUpdateProject,
  onAddRow,
  onRemoveRow,
}: TimesheetTableProps) {
  const canAddRow = !isLocked && status !== "submitted";
  return (
    <div className="rounded-lg border border-border shadow-app overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-table-header border-b border-border">
              <th className="sticky left-0 bg-table-header z-10 w-[260px] min-w-[240px] p-1.5 text-left text-xs font-bold text-muted-foreground">
                项目
                {canAddRow && (
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
              const rowLocked =
                isLocked ||
                row.approvalStatus === "approved" ||
                row.approvalStatus === "summary_pending" ||
                row.approvalStatus === "pending" ||
                (status === "submitted" && row.approvalStatus !== "rejected");
              const canRemoveRow = !rowLocked && status !== "submitted";
              return (
                <tr key={ri} className="border-b border-border/50 hover:bg-row-hover">
                  <td className="sticky left-0 bg-white p-1.5 z-[5]">
                    <div className="flex items-center gap-1">
                      <RowApprovalStatus status={row.approvalStatus} />
                      <ProjectPicker
                        projects={projects}
                        value={row.projectId}
                        disabled={rowLocked}
                        onChange={(projectId) => onUpdateProject(ri, projectId)}
                      />
                      {canRemoveRow && (
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
                        locked={rowLocked}
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
                      {rowTotal.toFixed(2)}
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
                      disabled={rowLocked}
                      placeholder="备注"
                    />
                  </td>
                </tr>
              );
            })}

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
                <span
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    weekDays.reduce((s, d) => s + dayTotals[d] / 100, 0) >
                      MAX_REGULAR_WEEK_WORKDAYS && "text-destructive",
                  )}
                >
                  {formatWorkdays(
                    weekDays.reduce((s, d) => s + dayTotals[d] / 100, 0),
                  )}
                </span>
              </td>
              <td />
            </tr>

            <tr className="border-b border-border/50">
              <td className="sticky left-0 bg-white p-1.5 text-sm font-bold text-warning z-[5]">
                加班 OT（预留）
              </td>
              {weekDays.map((day) => (
                <td key={day} className="p-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    className="h-8 w-[72px] mx-auto text-right text-sm text-warning"
                    value={overtime[day]?.hours || ""}
                    onChange={(e) => {
                      if (isLocked) return;
                      onUpdateOvertime(day, parseFloat(e.target.value) || 0);
                    }}
                    disabled
                    title="OT 功能预留，当前公司按普通出勤工时统计"
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

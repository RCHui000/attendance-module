import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { dayNames, holidayInfo } from "@/lib/constants";
import { parseLocalDate } from "@/utils/dates";
import { formatWorkdays, regularWorkdayCapacity } from "@/utils/validation";
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
  activeDays: string[];
  projects: ProjectBrief[];
  status: TimesheetStatus;
  isLocked: boolean;
  dayTotals: Record<string, number>;
  onUpdatePercent: (rowIndex: number, day: string, value: number) => void;
  onUpdateOvertime: (day: string, hours: number) => void;
  onUpdateDescription: (rowIndex: number, day: string, value: string) => void;
  onUpdateProject: (rowIndex: number, projectId: number) => void;
  onEditComplete: (context?: { day?: string }) => void;
  onAddRow: () => void;
  onRemoveRow: (rowIndex: number) => void;
}

function PercentCell({
  value,
  onChange,
  onCommit,
  locked,
  invalid,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit: () => void;
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
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" || event.key === "Tab") onCommit();
    },
    [onCommit],
  );

  return (
    <div className="flex items-center gap-1.5 w-[90px]">
      <Input
        type="number"
        min="0"
        max="100"
        step="1"
        className={cn(
          "h-8 w-[72px] text-right text-base md:text-sm",
          invalid && "border-destructive bg-red-50",
        )}
        value={value || ""}
        onChange={handleChange}
        onBlur={onCommit}
        onKeyDown={handleKeyDown}
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
      label: "\u5df2\u6279\u51c6",
      icon: CheckCircle2,
      className: "text-status-approved-text bg-status-approved-bg",
    },
    summary_pending: {
      label: "\u5f85\u6c47\u603b",
      icon: CheckCircle2,
      className: "text-status-approved-text bg-status-approved-bg",
    },
    pending: {
      label: "\u5ba1\u6279\u4e2d",
      icon: Clock3,
      className: "text-primary bg-primary/10",
    },
    rejected: {
      label: "\u5df2\u9000\u56de",
      icon: XCircle,
      className: "text-destructive bg-destructive/10",
    },
    draft: {
      label: "\u8349\u7a3f",
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
  onCommit,
}: {
  projects: ProjectBrief[];
  value?: number | null;
  disabled: boolean;
  onChange: (projectId: number) => void;
  onCommit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [popupStyle, setPopupStyle] = useState({
    top: 0,
    left: 0,
    width: 320,
  });
  const selected = projects.find((project) => project.id === value);
  const selectedLabel = selected ? `${selected.code} - ${selected.name}` : "";
  const normalizedQuery = query.trim().toLowerCase();
  const filteredProjects = useMemo(() => {
    if (!normalizedQuery) return projects;
    return projects.filter((project) => {
      const haystack = `${project.code} ${project.name}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, projects]);

  const updatePopupPosition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
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

  const handleCommit = useCallback(() => {
    setQuery(selectedLabel);
    onCommit();
  }, [onCommit, selectedLabel]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        setQuery(selectedLabel);
        requestAnimationFrame(updatePopupPosition);
      }
    },
    [selectedLabel, updatePopupPosition],
  );

  const handleSelect = useCallback(
    (projectId: number) => {
      const project = projects.find((item) => item.id === projectId);
      onChange(projectId);
      setQuery(project ? `${project.code} - ${project.name}` : "");
      setOpen(false);
      requestAnimationFrame(onCommit);
    },
    [onChange, onCommit, projects],
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (inputRef.current?.contains(target) || popupRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
      handleCommit();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery(selectedLabel);
      }
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
  }, [handleCommit, open, selectedLabel, updatePopupPosition]);

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
          <div className="max-h-64 overflow-y-auto p-1" role="listbox">
            {filteredProjects.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {"\u6ca1\u6709\u5339\u914d\u9879\u76ee"}
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
                    onMouseDown={(event) => event.preventDefault()}
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
      <div className="relative flex-1 min-w-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={open ? query : selectedLabel}
          onFocus={() => handleOpenChange(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              if (!popupRef.current?.matches(":hover")) handleCommit();
            }, 0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Tab") {
              const first = filteredProjects[0];
              if (first && open && query.trim()) {
                event.preventDefault();
                handleSelect(first.id);
              } else {
                setOpen(false);
                handleCommit();
              }
            }
          }}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          title={selectedLabel || "输入关键字检索"}
          placeholder="输入关键字检索"
          className="h-8 pr-8 pl-8 text-base md:text-sm"
        />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      {popup}
    </>
  );
}
function DayHeader({ day, index, active }: { day: string; index: number; active: boolean }) {
  const date = parseLocalDate(day);
  const dayOfWeek = date.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isRest = holidayInfo[day]?.type === "rest";
  const isWork = holidayInfo[day]?.type === "work";

  return (
    <th className="w-[90px] text-center p-1.5">
      <strong
        className={cn(
          "block text-sm leading-tight",
          !active && "text-muted-foreground/45",
          active && (isWeekend || isRest) && !isWork && "text-destructive",
          active && isWork && "text-warning",
        )}
      >
        {dayNames[index]}
      </strong>
      {active ? (
        <>
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
        </>
      ) : (
        <span className="block h-[18px]" aria-hidden="true" />
      )}
    </th>
  );
}

export const TimesheetTable = memo(function TimesheetTable({
  rows,
  overtime,
  weekDays,
  activeDays,
  projects,
  status,
  isLocked,
  dayTotals,
  onUpdatePercent,
  onUpdateOvertime,
  onUpdateDescription,
  onUpdateProject,
  onEditComplete,
  onAddRow,
  onRemoveRow,
}: TimesheetTableProps) {
  const canAddRow = !isLocked && status !== "submitted";
  const activeDaySet = useMemo(() => new Set(activeDays), [activeDays]);
  const maxRegularWorkdays = useMemo(() => regularWorkdayCapacity(activeDays), [activeDays]);
  return (
    <div className="rounded-lg border border-border shadow-app overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-table-header border-b border-border">
              <th className="sticky left-0 bg-table-header z-10 w-[260px] min-w-[240px] p-1.5 text-left text-xs font-bold text-muted-foreground">
                {"\u9879\u76ee"}
                {canAddRow && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-1 size-8 p-0"
                    onClick={onAddRow}
                    title="\u6dfb\u52a0\u9879\u76ee"
                  >
                    <Plus className="size-4" />
                  </Button>
                )}
              </th>
              {weekDays.map((day, i) => (
                <DayHeader key={day} day={day} index={i} active={activeDaySet.has(day)} />
              ))}
              <th className="w-[70px] p-1.5 text-center text-xs font-bold text-muted-foreground">
                {"\u5468\u5408\u8ba1"}
              </th>
              <th className="w-[100px] p-1.5 text-center text-xs font-bold text-muted-foreground">
                备注
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const rowTotal = activeDays.reduce(
                (s, d) => s + (row.percents[d] || 0) / 100,
                0,
              );
              const isIntentPlaceholder =
                !row.approvalStatus &&
                !row.projectId &&
                activeDays.every((day) => (row.percents[day] || 0) === 0);
              const rowLocked =
                isLocked ||
                row.approvalStatus === "approved" ||
                row.approvalStatus === "summary_pending" ||
                row.approvalStatus === "pending" ||
                (status === "submitted" && row.approvalStatus !== "rejected" && !isIntentPlaceholder);
              const canRemoveRow = !rowLocked && (status !== "submitted" || isIntentPlaceholder);
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
                        onCommit={onEditComplete}
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

                  {weekDays.map((day) => {
                    const isActiveDay = activeDaySet.has(day);
                    return (
                      <td key={day} className="p-1.5">
                        {isActiveDay ? (
                          <PercentCell
                            value={row.percents[day] || 0}
                            onChange={(v) => onUpdatePercent(ri, day, v)}
                            onCommit={() => onEditComplete({ day })}
                            locked={rowLocked}
                            invalid={dayTotals[day] > 100}
                          />
                        ) : (
                          <div className="h-8 w-[90px]" aria-hidden="true" />
                        )}
                      </td>
                    );
                  })}

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
                      className="h-8 text-base resize-none md:text-sm"
                      value={
                        row.descriptions.__row ||
                        Object.values(row.descriptions).find(
                          (d) => d?.trim(),
                        ) || ""
                      }
                      onChange={(e) =>
                        onUpdateDescription(ri, "__row", e.target.value)
                      }
                      onBlur={() => onEditComplete()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === "Tab") onEditComplete();
                      }}
                      disabled={rowLocked}
                      placeholder="备注"
                    />
                  </td>
                </tr>
              );
            })}

            <tr className="border-t-2 border-border bg-[#fafafa]">
              <td className="sticky left-0 bg-[#fafafa] p-1.5 text-sm font-bold text-muted-foreground z-[5]">
                {"\u6bcf\u65e5\u5408\u8ba1"}
              </td>
              {weekDays.map((day) => (
                <td key={day} className="p-1.5 text-center">
                  {activeDaySet.has(day) && (
                    <span
                      className={cn(
                        "text-sm font-bold tabular-nums",
                        dayTotals[day] > 100 && "text-destructive",
                      )}
                    >
                      {dayTotals[day]}%
                    </span>
                  )}
                </td>
              ))}
              <td className="p-1.5 text-center">
                <span
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    activeDays.reduce((s, d) => s + dayTotals[d] / 100, 0) >
                      maxRegularWorkdays && "text-destructive",
                  )}
                >
                  {formatWorkdays(
                    activeDays.reduce((s, d) => s + dayTotals[d] / 100, 0),
                  )}
                </span>
              </td>
              <td />
            </tr>

            <tr className="border-b border-border/50">
              <td className="sticky left-0 bg-white p-1.5 text-sm font-bold text-warning z-[5]">
                {"\u52a0\u73ed OT\uff08\u9884\u7559\uff09"}
              </td>
              {weekDays.map((day) => (
                <td key={day} className="p-1.5">
                  {activeDaySet.has(day) && (
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      className="h-8 w-[72px] mx-auto text-right text-base text-warning md:text-sm"
                      value={overtime[day]?.hours || ""}
                      onChange={(e) => {
                        if (isLocked) return;
                        onUpdateOvertime(day, parseFloat(e.target.value) || 0);
                      }}
                      disabled
                      title="\u52a0\u73ed\u8bb0\u5f55\u6682\u4e0d\u652f\u6301\u5728\u9879\u76ee\u5757\u4e2d\u7f16\u8f91"
                      placeholder="0"
                    />
                  )}
                </td>
              ))}
              <td className="p-1.5 text-center">
                <span className="text-sm font-bold tabular-nums text-warning">
                  {activeDays
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

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { useProjectDetail } from "@/hooks/useReport";
import { formatMoney } from "@/utils/dates";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DashboardProject } from "@/types/project";

const COL_SPAN = 8; // code, name, contract, received, receivable, labor_days, people

interface DashboardTableProps {
  projects: DashboardProject[];
  startDate: string;
  endDate: string;
}

/** The expandable detail sub-table shown under a project row */
function ExpandedRow({
  projectId,
  startDate,
  endDate,
}: {
  projectId: number;
  startDate: string;
  endDate: string;
}) {
  const { data, isLoading, isError } = useProjectDetail(
    projectId,
    startDate,
    endDate,
  );

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={COL_SPAN + 1} className="p-0 border-b">
        <div className="px-4 py-3 bg-[#f8fafc]">
          {isLoading && (
            <span className="text-sm text-muted-foreground">加载中…</span>
          )}

          {isError && (
            <span className="text-sm text-destructive">
              明细加载失败
            </span>
          )}

          {!isLoading && !isError && (!data || data.length === 0) && (
            <span className="text-sm text-muted-foreground">暂无人员明细</span>
          )}

          {!isLoading && !isError && data && data.length > 0 && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-muted-foreground">
                  人员投入明细
                </span>
                <span className="text-xs text-muted-foreground">
                  {startDate} 至 {endDate}
                </span>
                <span className="text-xs text-muted-foreground ml-auto">
                  合计{" "}
                  {data
                    .reduce((s, e) => s + (e.total_hours || 0), 0)
                    .toFixed(1)}{" "}
                  工日
                </span>
              </div>

              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 text-xs font-bold text-muted-foreground">
                      姓名
                    </th>
                    <th className="text-left py-1.5 text-xs font-bold text-muted-foreground">
                      部门
                    </th>
                    <th className="text-right py-1.5 text-xs font-bold text-muted-foreground w-20">
                      出勤天数
                    </th>
                    <th className="text-right py-1.5 text-xs font-bold text-muted-foreground w-20">
                      总工时
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((emp, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1.5 text-sm font-medium">
                        {emp.name}
                      </td>
                      <td className="py-1.5 text-sm text-muted-foreground">
                        {emp.department || "—"}
                      </td>
                      <td className="py-1.5 text-sm text-right tabular-nums">
                        {emp.work_days}
                      </td>
                      <td className="py-1.5 text-sm text-right tabular-nums">
                        {emp.total_hours?.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-1.5 text-sm font-bold">合计</td>
                    <td />
                    <td className="py-1.5 text-sm text-right tabular-nums font-bold">
                      {data.reduce((s, e) => s + (e.work_days || 0), 0)}
                    </td>
                    <td className="py-1.5 text-sm text-right tabular-nums font-bold">
                      {data
                        .reduce((s, e) => s + (e.total_hours || 0), 0)
                        .toFixed(1)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function DashboardTable({ projects, startDate, endDate }: DashboardTableProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const toggleProject = (projectId: number) => {
    setExpandedId((current) => (current === projectId ? null : projectId));
  };

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        暂无项目数据
      </div>
    );
  }

  const maxContract = Math.max(
    ...projects.map((p) => p.contract_amount || 0),
    1,
  );

  // Build flat row list to avoid React fragment key issues
  const rows: React.ReactNode[] = [];
  projects.forEach((project) => {
    const isExpanded = expandedId === project.id;
    rows.push(
      <TableRow
        key={project.id}
        tabIndex={0}
        aria-expanded={isExpanded}
        className="hover:bg-row-hover cursor-pointer transition-colors outline-none focus-visible:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => toggleProject(project.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleProject(project.id);
          }
        }}
      >
        <TableCell className="w-7 p-0">
          <div className="flex items-center justify-center">
            {isExpanded ? (
              <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm font-medium">
          {project.code}
        </TableCell>
        <TableCell className="text-sm">{project.name}</TableCell>
        <TableCell className="text-sm text-right tabular-nums">
          {formatMoney(project.contract_amount)}
        </TableCell>
        <TableCell className="text-sm text-right tabular-nums text-success">
          {formatMoney(project.received_amount)}
        </TableCell>
        <TableCell className="text-sm text-right tabular-nums text-warning">
          {formatMoney(project.receivable_amount)}
        </TableCell>
        <TableCell className="text-sm text-right tabular-nums font-medium">
          {project.labor_days?.toFixed(1) || "—"}
        </TableCell>
        <TableCell className="w-[120px] px-3">
          <Progress
            value={
              maxContract > 0
                ? ((project.contract_amount || 0) / maxContract) * 100
                : 0
            }
            className="h-2.5 rounded-pill"
          />
        </TableCell>
      </TableRow>,
    );

    if (isExpanded) {
      rows.push(
        <ExpandedRow
          key={`detail-${project.id}`}
          projectId={project.id}
          startDate={startDate}
          endDate={endDate}
        />,
      );
    }
  });

  return (
    <div className="rounded-lg border border-border shadow-app overflow-hidden">
      <div className="overflow-auto max-h-[70vh]">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-table-header">
            <TableRow>
              <TableHead className="text-xs font-bold w-7" />
              <TableHead className="text-xs font-bold">项目代码</TableHead>
              <TableHead className="text-xs font-bold">项目名称</TableHead>
              <TableHead className="text-xs font-bold text-right">合同额</TableHead>
              <TableHead className="text-xs font-bold text-right">已回款</TableHead>
              <TableHead className="text-xs font-bold text-right">待回款</TableHead>
              <TableHead className="text-xs font-bold text-right">期间工日</TableHead>
              <TableHead className="text-xs font-bold text-center">合同占比</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{rows}</TableBody>
        </Table>
      </div>
    </div>
  );
}

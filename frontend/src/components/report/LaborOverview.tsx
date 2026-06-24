import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Eye, Download } from "lucide-react";
import type { ReportData } from "@/types/project";
import { ProjectDrawer } from "./ProjectDrawer";

interface LaborOverviewProps {
  report: ReportData;
}

export function LaborOverview({ report }: LaborOverviewProps) {
  const [detailProjectId, setDetailProjectId] = useState<number | null>(null);

  const peopleCount = new Set(
    report.employees?.map((e) => e.id) || [],
  ).size;
  const totalHours =
    report.projects?.reduce((s, p) => s + (p.total_hours || 0), 0) || 0;
  const activeProjects = report.projects?.length || 0;

  if (!report.projects?.length) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground">
        暂无项目数据
      </div>
    );
  }

  const maxHours = Math.max(
    ...report.projects.map((p) => p.total_hours || 0),
    1,
  );

  return (
    <>
      {/* Metrics */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <Card className="min-w-[160px] flex-1 p-3.5 shadow-app rounded-lg">
          <span className="text-xs text-muted-foreground">已填员工</span>
          <strong className="block text-2xl font-bold tabular-nums mt-1">
            {peopleCount}
          </strong>
        </Card>
        <Card className="min-w-[160px] flex-1 p-3.5 shadow-app rounded-lg">
          <span className="text-xs text-muted-foreground">
            {report.startDate} 至 {report.endDate} 总工日
          </span>
          <strong className="block text-2xl font-bold tabular-nums mt-1">
            {totalHours.toFixed(1)}
          </strong>
        </Card>
        <Card className="min-w-[160px] flex-1 p-3.5 shadow-app rounded-lg">
          <span className="text-xs text-muted-foreground">活跃项目</span>
          <strong className="block text-2xl font-bold tabular-nums mt-1">
            {activeProjects}
          </strong>
        </Card>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border shadow-app overflow-hidden">
        <div className="overflow-auto max-h-[60vh]">
          <Table>
            <TableHeader className="sticky top-0 bg-table-header">
              <TableRow>
                <TableHead className="text-xs font-bold">项目代码</TableHead>
                <TableHead className="text-xs font-bold">项目名称</TableHead>
                <TableHead className="text-xs font-bold text-right">人数</TableHead>
                <TableHead className="text-xs font-bold text-right">总工日</TableHead>
                <TableHead className="text-xs font-bold">工时占比</TableHead>
                <TableHead className="text-xs font-bold text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.projects.map((project) => (
                <TableRow
                  key={project.id}
                  className="hover:bg-row-hover cursor-pointer transition-colors"
                  onClick={() => setDetailProjectId(project.id ?? null)}
                >
                  <TableCell className="text-sm font-medium">
                    {project.code || `P${project.id}`}
                  </TableCell>
                  <TableCell className="text-sm">{project.name}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">
                    {project.people_count}
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums">
                    {project.total_hours?.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-sm w-[160px]">
                    <Progress
                      value={
                        maxHours > 0
                          ? ((project.total_hours || 0) / maxHours) * 100
                          : 0
                      }
                      className="h-2.5 rounded-pill"
                    />
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-full"
                        onClick={() => setDetailProjectId(project.id ?? null)}
                      >
                        <Eye className="size-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 rounded-full">
                        <Download className="size-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Project Detail Drawer */}
      <ProjectDrawer
        projectId={detailProjectId}
        startDate={report.startDate}
        endDate={report.endDate}
        open={detailProjectId != null}
        onClose={() => setDetailProjectId(null)}
      />
    </>
  );
}

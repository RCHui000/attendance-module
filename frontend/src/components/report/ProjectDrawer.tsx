import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProjectDetail } from "@/hooks/useReport";

interface ProjectDrawerProps {
  projectId: number | null;
  startDate: string;
  endDate: string;
  open: boolean;
  onClose: () => void;
}

export function ProjectDrawer({
  projectId,
  startDate,
  endDate,
  open,
  onClose,
}: ProjectDrawerProps) {
  const { data, isLoading } = useProjectDetail(
    open ? projectId : null,
    startDate,
    endDate,
  );

  if (!open) return null;

  const totalHours =
    data?.reduce((sum, e) => sum + (e.total_hours || 0), 0) || 0;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px] p-0">
        {isLoading && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            加载中…
          </div>
        )}
        {data && (
          <div className="flex flex-col h-full">
            <SheetHeader className="px-5 py-4 border-b border-border shrink-0">
              <SheetTitle className="text-lg">项目人员明细</SheetTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {startDate} 至 {endDate} · 合计 {totalHours.toFixed(1)} 工日
              </p>
            </SheetHeader>
            <div className="flex-1 overflow-auto px-5 py-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-bold">姓名</TableHead>
                    <TableHead className="text-xs font-bold">部门</TableHead>
                    <TableHead className="text-xs font-bold text-right">
                      工日
                    </TableHead>
                    <TableHead className="text-xs font-bold text-right">
                      总工时
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((emp, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm font-medium">
                        {emp.name}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {emp.department || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {emp.work_days}
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {emp.total_hours?.toFixed(1)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2">
                    <TableCell className="text-sm font-bold">合计</TableCell>
                    <TableCell />
                    <TableCell className="text-sm text-right tabular-nums font-bold">
                      {data.reduce((s, e) => s + (e.work_days || 0), 0)}
                    </TableCell>
                    <TableCell className="text-sm text-right tabular-nums font-bold">
                      {totalHours.toFixed(1)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

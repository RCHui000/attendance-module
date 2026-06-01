import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useProjectBase,
  useSaveProject,
  useDeleteProject,
} from "@/hooks/useReport";
import { useOrganizations, useEmployees } from "@/hooks/useEmployees";
import { formatMoney } from "@/utils/dates";
import { Pencil, Trash2, Plus } from "lucide-react";
import type { ProjectBase } from "@/types/project";
import { toast } from "sonner";

export function ProjectList() {
  const { data: projects = [], isLoading, isError } = useProjectBase();
  const { data: orgs = [] } = useOrganizations();
  const { data: employees = [] } = useEmployees();
  const saveProject = useSaveProject();
  const deleteProject = useDeleteProject();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editData, setEditData] = useState({
    code: "",
    name: "",
    contractAmount: "",
    receivedAmount: "",
    projectOwnerId: "",
  });
  const [deleteTarget, setDeleteTarget] = useState<ProjectBase | null>(null);

  const startEdit = (project?: ProjectBase) => {
    if (project) {
      setEditingId(project.id);
      setIsNew(false);
      setEditData({
        code: project.code,
        name: project.name,
        contractAmount: String(project.contract_amount || ""),
        receivedAmount: String(project.received_amount || ""),
        projectOwnerId: project.project_owner_id ? String(project.project_owner_id) : "",
      });
    } else {
      setEditingId(null);
      setIsNew(true);
      setEditData({
        code: "",
        name: "",
        contractAmount: "",
        receivedAmount: "",
        projectOwnerId: "",
      });
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsNew(false);
  };

  const handleSave = () => {
    if (!editData.code.trim() || !editData.name.trim()) {
      toast.error("项目代码和名称不能为空");
      return;
    }
    saveProject.mutate(
      {
        id: isNew ? undefined : editingId ?? undefined,
        code: editData.code.trim(),
        name: editData.name.trim(),
        contractAmount: parseFloat(editData.contractAmount) || 0,
        receivedAmount: parseFloat(editData.receivedAmount) || 0,
        projectOwnerId: editData.projectOwnerId ? Number(editData.projectOwnerId) : undefined,
      },
      {
        onSuccess: () => {
          toast.success(isNew ? "项目已创建" : "项目已更新");
          cancelEdit();
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "保存失败"),
      },
    );
  };

  const handleDeleteClick = () => {
    if (!selectedId) {
      toast.error("请先在列表中选中要删除的项目");
      return;
    }
    const project = projects.find((p) => p.id === selectedId);
    if (!project) {
      toast.error("选中的项目不存在，请刷新后重试");
      return;
    }
    setDeleteTarget(project);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    deleteProject.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("项目已删除");
        if (selectedId === deleteTarget.id) setSelectedId(null);
      },
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "删除失败"),
    });
    setDeleteTarget(null);
  };

  const handleRowClick = (id: number) => {
    if (editingId != null) return;
    setSelectedId(selectedId === id ? null : id);
  };

  if (isLoading) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="py-10 text-center text-sm text-destructive">
        加载失败
      </div>
    );
  }

  return (
    <div>
      {/* Action buttons — left aligned, matching Employee page style */}
      <div className="flex items-center gap-2 mb-3">
        <Button size="sm" onClick={() => startEdit()}>
          <Plus className="size-3.5 mr-1" />
          新增项目
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={!selectedId}
          onClick={handleDeleteClick}
        >
          <Trash2 className="size-3.5 mr-1" />
          删除项目
        </Button>
      </div>

      <div className="rounded-lg border border-border shadow-app overflow-hidden">
        <div className="overflow-auto max-h-[65vh]">
          <Table>
            <TableHeader className="sticky top-0 bg-table-header z-10">
              <TableRow>
                <TableHead className="text-xs font-bold w-[60px] sticky left-0 bg-table-header z-20">
                  操作
                </TableHead>
                <TableHead className="text-xs font-bold">项目代码</TableHead>
                <TableHead className="text-xs font-bold">项目名称</TableHead>
                <TableHead className="text-xs font-bold">项目负责人</TableHead>
                <TableHead className="text-xs font-bold text-right">合同额</TableHead>
                <TableHead className="text-xs font-bold text-right">已回款</TableHead>
                <TableHead className="text-xs font-bold text-right">待回款</TableHead>
                <TableHead className="text-xs font-bold text-right">累计工日</TableHead>
                <TableHead className="text-xs font-bold text-right">累计支出</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* New row */}
              {isNew && (
                <TableRow>
                  <TableCell className="p-1.5 sticky left-0 bg-white z-[5]">
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleSave}
                      >
                        保存
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={cancelEdit}
                      >
                        取消
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-sm"
                      value={editData.code}
                      onChange={(e) =>
                        setEditData((d) => ({ ...d, code: e.target.value }))
                      }
                      placeholder="代码"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-sm"
                      value={editData.name}
                      onChange={(e) =>
                        setEditData((d) => ({ ...d, name: e.target.value }))
                      }
                      placeholder="名称"
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={editData.projectOwnerId}
                      onValueChange={(v) =>
                        setEditData((d) => ({ ...d, projectOwnerId: v || "" }))
                      }
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="项目负责人" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">未设置</SelectItem>
                        {employees.map((emp) => (
                          <SelectItem key={emp.id} value={String(emp.id)}>
                            {emp.name} · {emp.org_name || emp.department || "—"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-sm text-right"
                      type="number"
                      value={editData.contractAmount}
                      onChange={(e) =>
                        setEditData((d) => ({
                          ...d,
                          contractAmount: e.target.value,
                        }))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-sm text-right"
                      type="number"
                      value={editData.receivedAmount}
                      onChange={(e) =>
                        setEditData((d) => ({
                          ...d,
                          receivedAmount: e.target.value,
                        }))
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {formatMoney(
                      parseFloat(editData.contractAmount || "0") -
                        parseFloat(editData.receivedAmount || "0"),
                    )}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              )}

              {projects.map((project) =>
                editingId === project.id ? (
                  <TableRow key={project.id}>
                    <TableCell className="p-1.5 sticky left-0 bg-white z-[5]">
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={handleSave}
                        >
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={cancelEdit}
                        >
                          取消
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-sm"
                        value={editData.code}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, code: e.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-sm"
                        value={editData.name}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, name: e.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={editData.projectOwnerId}
                        onValueChange={(v) =>
                          setEditData((d) => ({ ...d, projectOwnerId: v || "" }))
                        }
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="项目负责人" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">未设置</SelectItem>
                          {employees.map((emp) => (
                            <SelectItem key={emp.id} value={String(emp.id)}>
                              {emp.name} · {emp.org_name || emp.department || "—"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-sm text-right"
                        type="number"
                        value={editData.contractAmount}
                        onChange={(e) =>
                          setEditData((d) => ({
                            ...d,
                            contractAmount: e.target.value,
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-sm text-right"
                        type="number"
                        value={editData.receivedAmount}
                        onChange={(e) =>
                          setEditData((d) => ({
                            ...d,
                            receivedAmount: e.target.value,
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                      {formatMoney(
                        parseFloat(editData.contractAmount || "0") -
                          parseFloat(editData.receivedAmount || "0"),
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {project.total_labor_hours?.toFixed(1) || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatMoney(project.total_labor_cost)}
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow
                    key={project.id}
                    className={cn(
                      "hover:bg-row-hover cursor-pointer transition-colors",
                      selectedId === project.id && "bg-row-selected",
                    )}
                    onClick={() => handleRowClick(project.id)}
                  >
                    <TableCell
                      className="p-1.5 sticky left-0 bg-white z-[5]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(project);
                        }}
                      >
                        <Pencil className="size-3 mr-1" />
                        编辑
                      </Button>
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {project.code}
                    </TableCell>
                    <TableCell className="text-sm">{project.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {project.project_owner_name ||
                        project.owner_org_name ||
                        "—"}
                    </TableCell>
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
                      {project.total_labor_hours?.toFixed(1) || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-right tabular-nums">
                      {formatMoney(project.total_labor_cost)}
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除项目「{deleteTarget?.code} {deleteTarget?.name}」吗？删除后项目不再显示，历史工日数据保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

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
import { useEmployees, useOrganizations } from "@/hooks/useEmployees";
import { formatMoney } from "@/utils/dates";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { ProjectBase, ProjectDepartmentOwner } from "@/types/project";
import { toast } from "sonner";

const NONE = "none";
const selectValue = (value: string | null) => (value && value !== NONE ? value : "");

type EditOwner = {
  id?: number;
  org_id: string;
  project_owner_id: string;
};

type EditData = {
  code: string;
  name: string;
  contractAmount: string;
  receivedAmount: string;
  projectOwnerId: string;
  departmentOwners: EditOwner[];
};

const emptyEditData: EditData = {
  code: "",
  name: "",
  contractAmount: "",
  receivedAmount: "",
  projectOwnerId: "",
  departmentOwners: [],
};

function ownerSummary(owners?: ProjectDepartmentOwner[]) {
  const active = (owners || []).filter((owner) => owner.is_active !== false);
  if (!active.length) return "未配置";
  return active
    .map((owner) => `${owner.org_name || "部门"}: ${owner.project_owner_name || "负责人"}`)
    .join(" / ");
}

export function ProjectList() {
  const { data: projects = [], isLoading, isError } = useProjectBase();
  const { data: employees = [] } = useEmployees();
  const { data: organizations = [] } = useOrganizations();
  const saveProject = useSaveProject();
  const deleteProject = useDeleteProject();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editData, setEditData] = useState<EditData>(emptyEditData);
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
        departmentOwners: (project.department_owners || [])
          .filter((owner) => owner.is_active !== false)
          .map((owner) => ({
            id: owner.id,
            org_id: owner.org_id ? String(owner.org_id) : "",
            project_owner_id: owner.project_owner_id ? String(owner.project_owner_id) : "",
          })),
      });
    } else {
      setEditingId(null);
      setIsNew(true);
      setEditData(emptyEditData);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsNew(false);
    setEditData(emptyEditData);
  };

  const setOwnerRow = (index: number, patch: Partial<EditOwner>) => {
    setEditData((data) => ({
      ...data,
      departmentOwners: data.departmentOwners.map((owner, i) =>
        i === index ? { ...owner, ...patch } : owner,
      ),
    }));
  };

  const addOwnerRow = () => {
    setEditData((data) => ({
      ...data,
      departmentOwners: [...data.departmentOwners, { org_id: "", project_owner_id: "" }],
    }));
  };

  const removeOwnerRow = (index: number) => {
    setEditData((data) => ({
      ...data,
      departmentOwners: data.departmentOwners.filter((_, i) => i !== index),
    }));
  };

  const handleSave = () => {
    if (!editData.code.trim() || !editData.name.trim()) {
      toast.error("项目代码和项目名称不能为空");
      return;
    }
    const departmentOwners = editData.departmentOwners
      .map((owner) => ({
        id: owner.id,
        org_id: Number(owner.org_id),
        project_owner_id: Number(owner.project_owner_id),
      }))
      .filter((owner) => owner.org_id && owner.project_owner_id);

    const duplicateOrg = new Set<number>();
    for (const owner of departmentOwners) {
      if (duplicateOrg.has(owner.org_id)) {
        toast.error("同一个参与部门只能配置一位项目负责人");
        return;
      }
      duplicateOrg.add(owner.org_id);
    }

    saveProject.mutate(
      {
        id: isNew ? undefined : editingId ?? undefined,
        code: editData.code.trim(),
        name: editData.name.trim(),
        contractAmount: parseFloat(editData.contractAmount) || 0,
        receivedAmount: parseFloat(editData.receivedAmount) || 0,
        projectOwnerId: editData.projectOwnerId ? Number(editData.projectOwnerId) : undefined,
        departmentOwners,
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
      toast.error("请先选中要删除的项目");
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

  const renderOwnerEditor = () => (
    <div className="min-w-[360px] space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          参与部门与项目负责人
        </span>
        <Button type="button" variant="outline" size="sm" className="h-7" onClick={addOwnerRow}>
          <Plus className="mr-1 size-3.5" />
          添加部门
        </Button>
      </div>
      {editData.departmentOwners.length === 0 && (
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          未配置时使用默认项目负责人，默认负责人为空时回退到员工部门负责人。
        </div>
      )}
      {editData.departmentOwners.map((owner, index) => (
        <div key={`${owner.id || "new"}-${index}`} className="grid grid-cols-[1fr_1fr_32px] gap-2">
          <Select
            value={owner.org_id || NONE}
            onValueChange={(value) => setOwnerRow(index, { org_id: selectValue(value) })}
          >
            <SelectTrigger className="h-8 w-full text-sm">
              <SelectValue placeholder="参与部门" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>选择部门</SelectItem>
              {organizations.map((org) => (
                <SelectItem key={org.id} value={String(org.id)}>
                  {org.org_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={owner.project_owner_id || NONE}
            onValueChange={(value) =>
              setOwnerRow(index, { project_owner_id: selectValue(value) })
            }
          >
            <SelectTrigger className="h-8 w-full text-sm">
              <SelectValue placeholder="项目负责人" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>选择负责人</SelectItem>
              {employees.map((emp) => (
                <SelectItem key={emp.id} value={String(emp.id)}>
                  {emp.name} · {emp.org_name || emp.department || "未分配"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            onClick={() => removeOwnerRow(index)}
            title="移除"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );

  const renderEditRow = (project?: ProjectBase) => (
    <TableRow key={project?.id || "new"}>
      <TableCell className="sticky left-0 z-[5] bg-white p-1.5">
        <div className="flex gap-1">
          <Button size="sm" className="h-7 text-xs" onClick={handleSave}>
            保存
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={cancelEdit}>
            取消
          </Button>
        </div>
      </TableCell>
      <TableCell>
        <Input
          className="h-8 text-sm"
          value={editData.code}
          onChange={(e) => setEditData((data) => ({ ...data, code: e.target.value }))}
          placeholder="代码"
        />
      </TableCell>
      <TableCell>
        <Input
          className="h-8 min-w-[180px] text-sm"
          value={editData.name}
          onChange={(e) => setEditData((data) => ({ ...data, name: e.target.value }))}
          placeholder="名称"
        />
      </TableCell>
      <TableCell>
        <Select
          value={editData.projectOwnerId || NONE}
          onValueChange={(value) =>
            setEditData((data) => ({ ...data, projectOwnerId: selectValue(value) }))
          }
        >
          <SelectTrigger className="h-8 w-[180px] text-sm">
            <SelectValue placeholder="默认负责人" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>未设置</SelectItem>
            {employees.map((emp) => (
              <SelectItem key={emp.id} value={String(emp.id)}>
                {emp.name} · {emp.org_name || emp.department || "未分配"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>{renderOwnerEditor()}</TableCell>
      <TableCell>
        <Input
          className="h-8 w-[120px] text-right text-sm"
          type="number"
          value={editData.contractAmount}
          onChange={(e) => setEditData((data) => ({ ...data, contractAmount: e.target.value }))}
        />
      </TableCell>
      <TableCell>
        <Input
          className="h-8 w-[120px] text-right text-sm"
          type="number"
          value={editData.receivedAmount}
          onChange={(e) => setEditData((data) => ({ ...data, receivedAmount: e.target.value }))}
        />
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
        {formatMoney(
          (parseFloat(editData.contractAmount) || 0) -
            (parseFloat(editData.receivedAmount) || 0),
        )}
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {project?.total_labor_hours?.toFixed(1) || "-"}
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {formatMoney(project?.total_labor_cost || 0)}
      </TableCell>
    </TableRow>
  );

  if (isLoading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>;
  }
  if (isError) {
    return <div className="py-10 text-center text-sm text-destructive">加载失败</div>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" onClick={() => startEdit()}>
          <Plus className="mr-1 size-3.5" />
          新增项目
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={!selectedId}
          onClick={handleDeleteClick}
        >
          <Trash2 className="mr-1 size-3.5" />
          删除项目
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border shadow-app">
        <div className="max-h-[65vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-table-header">
              <TableRow>
                <TableHead className="sticky left-0 z-20 w-[64px] bg-table-header text-xs font-bold">
                  操作
                </TableHead>
                <TableHead className="text-xs font-bold">项目代码</TableHead>
                <TableHead className="text-xs font-bold">项目名称</TableHead>
                <TableHead className="text-xs font-bold">默认负责人</TableHead>
                <TableHead className="min-w-[360px] text-xs font-bold">参与部门负责人</TableHead>
                <TableHead className="text-right text-xs font-bold">合同额</TableHead>
                <TableHead className="text-right text-xs font-bold">已回款</TableHead>
                <TableHead className="text-right text-xs font-bold">待回款</TableHead>
                <TableHead className="text-right text-xs font-bold">累计工日</TableHead>
                <TableHead className="text-right text-xs font-bold">累计支出</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isNew && renderEditRow()}
              {projects.map((project) =>
                editingId === project.id ? (
                  renderEditRow(project)
                ) : (
                  <TableRow
                    key={project.id}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-row-hover",
                      selectedId === project.id && "bg-row-selected",
                    )}
                    onClick={() => {
                      if (editingId == null) setSelectedId(selectedId === project.id ? null : project.id);
                    }}
                  >
                    <TableCell className="sticky left-0 z-[5] bg-white p-1.5" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(project);
                        }}
                      >
                        <Pencil className="mr-1 size-3" />
                        编辑
                      </Button>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{project.code}</TableCell>
                    <TableCell className="text-sm">{project.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {project.project_owner_name || "未设置"}
                    </TableCell>
                    <TableCell className="max-w-[460px] text-sm text-muted-foreground">
                      <span className="line-clamp-2">{ownerSummary(project.department_owners)}</span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatMoney(project.contract_amount)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-success">
                      {formatMoney(project.received_amount)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-warning">
                      {formatMoney(project.receivable_amount)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {project.total_labor_hours?.toFixed(1) || "-"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatMoney(project.total_labor_cost)}
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除项目 {deleteTarget?.code} {deleteTarget?.name} 吗？删除后项目不再显示，历史工时数据保留。
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

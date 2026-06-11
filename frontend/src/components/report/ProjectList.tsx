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
const serviceTypes = ["PM", "CC", "PMCC"] as const;

const roleLabels: Record<string, string> = {
  cc_project_owner: "CC项目负责人",
  cc_department_owner: "CC部门负责人",
  pm_cost_department_owner: "PM成本部负责人",
  pm_project_owner: "PM项目负责人",
  pm_department_owner: "PM部门负责人",
};

const rolesByServiceType: Record<(typeof serviceTypes)[number], string[]> = {
  PM: ["pm_project_owner", "pm_department_owner"],
  CC: ["cc_project_owner", "cc_department_owner"],
  PMCC: [
    "cc_project_owner",
    "pm_cost_department_owner",
    "pm_project_owner",
    "pm_department_owner",
  ],
};

type BusinessType = (typeof serviceTypes)[number];

type EditOwner = {
  id?: number;
  org_id: string;
  project_owner_id: string;
};

type EditRole = {
  role_key: string;
  user_id: string;
};

type EditData = {
  code: string;
  name: string;
  businessType: BusinessType | "";
  contractAmount: string;
  receivedAmount: string;
  departmentOwners: EditOwner[];
  projectRoles: EditRole[];
};

const emptyEditData: EditData = {
  code: "",
  name: "",
  businessType: "",
  contractAmount: "",
  receivedAmount: "",
  departmentOwners: [],
  projectRoles: [],
};

function selectValue(value: string | null) {
  return value && value !== NONE ? value : "";
}

function inferBusinessType(code: string): BusinessType | "" {
  const normalized = code.trim().toUpperCase();
  if (normalized.startsWith("PMCC")) return "PMCC";
  if (normalized.startsWith("PM")) return "PM";
  if (normalized.startsWith("CC")) return "CC";
  return "";
}

function ownerSummary(owners?: ProjectDepartmentOwner[]) {
  const active = (owners || []).filter((owner) => owner.is_active !== false);
  if (!active.length) return "未配置";
  return active
    .map((owner) => `${owner.org_name || "部门"}: ${owner.project_owner_name || "负责人"}`)
    .join(" / ");
}

function projectRoleSummary(project: ProjectBase) {
  const type = project.business_type || inferBusinessType(project.code);
  if (!type) return "未识别服务类型";
  const roles = new Map(
    (project.project_roles || []).map((role) => [role.role_key, role.user_name || "未配置"]),
  );
  return rolesByServiceType[type]
    .map((roleKey) => `${roleLabels[roleKey]}: ${roles.get(roleKey) || "未配置"}`)
    .join(" / ");
}

function serviceBadgeClass(type: ProjectBase["business_type"] | "") {
  if (type === "PM") return "border-sky-200 bg-sky-50 text-sky-700";
  if (type === "CC") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (type === "PMCC") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-border bg-muted text-muted-foreground";
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
    if (!project) {
      setEditingId(null);
      setIsNew(true);
      setEditData(emptyEditData);
      return;
    }

    const businessType = project.business_type || inferBusinessType(project.code);
    const roles = businessType ? rolesByServiceType[businessType] : [];
    setEditingId(project.id);
    setIsNew(false);
    setEditData({
      code: project.code,
      name: project.name,
      businessType,
      contractAmount: String(project.contract_amount || ""),
      receivedAmount: String(project.received_amount || ""),
      departmentOwners: (project.department_owners || [])
        .filter((owner) => owner.is_active !== false)
        .map((owner) => ({
          id: owner.id,
          org_id: owner.org_id ? String(owner.org_id) : "",
          project_owner_id: owner.project_owner_id ? String(owner.project_owner_id) : "",
        })),
      projectRoles: roles.map((roleKey) => {
        const role = (project.project_roles || []).find((item) => item.role_key === roleKey);
        return { role_key: roleKey, user_id: role?.user_id ? String(role.user_id) : "" };
      }),
    });
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

  const setRole = (roleKey: string, userId: string) => {
    setEditData((data) => {
      const exists = data.projectRoles.some((role) => role.role_key === roleKey);
      return {
        ...data,
        projectRoles: exists
          ? data.projectRoles.map((role) =>
              role.role_key === roleKey ? { ...role, user_id: userId } : role,
            )
          : [...data.projectRoles, { role_key: roleKey, user_id: userId }],
      };
    });
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
    if (!editData.code.trim()) {
      toast.error("合同编码不能为空");
      return;
    }
    if (!editData.name.trim()) {
      toast.error("项目名称不能为空");
      return;
    }

    const businessType = editData.businessType || inferBusinessType(editData.code);
    if (!businessType) {
      toast.error("请选择服务类型");
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
        toast.error("同一参与部门只能配置一位项目负责人");
        return;
      }
      duplicateOrg.add(owner.org_id);
    }

    const projectRoles = rolesByServiceType[businessType]
      .map((roleKey) => ({
        role_key: roleKey,
        user_id: Number(editData.projectRoles.find((role) => role.role_key === roleKey)?.user_id || 0),
      }))
      .filter((role) => role.user_id);

    saveProject.mutate(
      {
        id: isNew ? undefined : editingId ?? undefined,
        code: editData.code.trim(),
        name: editData.name.trim(),
        businessType,
        contractAmount: parseFloat(editData.contractAmount) || 0,
        receivedAmount: parseFloat(editData.receivedAmount) || 0,
        projectOwnerId: projectRoles.find((role) =>
          ["pm_project_owner", "cc_project_owner"].includes(role.role_key),
        )?.user_id,
        departmentOwners,
        projectRoles,
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

  const renderRoleEditor = () => {
    const businessType = editData.businessType || inferBusinessType(editData.code);
    if (!businessType) {
      return <div className="text-xs text-muted-foreground">选择服务类型后配置负责人</div>;
    }
    return (
      <div className="grid min-w-[520px] grid-cols-2 gap-2">
        {rolesByServiceType[businessType].map((roleKey) => (
          <Select
            key={roleKey}
            value={editData.projectRoles.find((role) => role.role_key === roleKey)?.user_id || NONE}
            onValueChange={(value) => setRole(roleKey, selectValue(value))}
          >
            <SelectTrigger className="h-8 w-full text-sm">
              <SelectValue placeholder={roleLabels[roleKey]} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{roleLabels[roleKey]}</SelectItem>
              {employees.map((emp) => (
                <SelectItem key={emp.id} value={String(emp.id)}>
                  {emp.name} · {emp.org_name || emp.department || "未分配"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      </div>
    );
  };

  const renderOwnerEditor = () => (
    <div className="min-w-[360px] space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">部门负责人</span>
        <Button type="button" variant="outline" size="sm" className="h-7" onClick={addOwnerRow}>
          <Plus className="mr-1 size-3.5" />
          添加部门
        </Button>
      </div>
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
              <SelectValue placeholder="部门负责人" />
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
          className="h-8 w-[120px] text-sm"
          value={editData.code}
          onChange={(e) => {
            const code = e.target.value;
            setEditData((data) => ({
              ...data,
              code,
              businessType: data.businessType || inferBusinessType(code),
            }));
          }}
          placeholder="PM26001"
        />
      </TableCell>
      <TableCell>
        <Select
          value={editData.businessType || NONE}
          onValueChange={(value) =>
            setEditData((data) => ({
              ...data,
              businessType: selectValue(value) as EditData["businessType"],
            }))
          }
        >
          <SelectTrigger className="h-8 w-[110px] text-sm">
            <SelectValue placeholder="服务类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>未识别</SelectItem>
            {serviceTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>{renderRoleEditor()}</TableCell>
      <TableCell>{renderOwnerEditor()}</TableCell>
      <TableCell>
        <Input
          className="h-8 w-[180px] text-sm"
          value={editData.name}
          onChange={(e) => setEditData((data) => ({ ...data, name: e.target.value }))}
          placeholder="项目名称"
        />
      </TableCell>
      <TableCell>
        <div className="grid w-[260px] grid-cols-2 gap-2">
          <Input
            className="h-8 text-right text-sm"
            type="number"
            value={editData.contractAmount}
            onChange={(e) => setEditData((data) => ({ ...data, contractAmount: e.target.value }))}
            placeholder="合同额"
          />
          <Input
            className="h-8 text-right text-sm"
            type="number"
            value={editData.receivedAmount}
            onChange={(e) => setEditData((data) => ({ ...data, receivedAmount: e.target.value }))}
            placeholder="已回款"
          />
        </div>
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {formatMoney(project?.total_labor_cost || 0)}
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {project?.total_labor_hours?.toFixed(1) || "-"}
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
                <TableHead className="text-xs font-bold">合同编码</TableHead>
                <TableHead className="text-xs font-bold">服务类型</TableHead>
                <TableHead className="min-w-[420px] text-xs font-bold">项目负责人</TableHead>
                <TableHead className="min-w-[300px] text-xs font-bold">部门负责人</TableHead>
                <TableHead className="text-xs font-bold">项目名称</TableHead>
                <TableHead className="text-right text-xs font-bold">财务状况</TableHead>
                <TableHead className="text-right text-xs font-bold">累计支出</TableHead>
                <TableHead className="text-right text-xs font-bold">累计工日</TableHead>
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
                    <TableCell>
                      <span className={cn("inline-flex rounded border px-2 py-0.5 text-xs font-medium", serviceBadgeClass(project.business_type || inferBusinessType(project.code)))}>
                        {project.business_type || inferBusinessType(project.code) || "-"}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[520px] text-sm text-muted-foreground">
                      <span className="line-clamp-2">{projectRoleSummary(project)}</span>
                    </TableCell>
                    <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                      <span className="line-clamp-2">{ownerSummary(project.department_owners)}</span>
                    </TableCell>
                    <TableCell className="text-sm">{project.name}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      <div>{formatMoney(project.contract_amount)}</div>
                      <div className="text-success">{formatMoney(project.received_amount)}</div>
                      <div className="text-warning">{formatMoney(project.receivable_amount)}</div>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatMoney(project.total_labor_cost)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {project.total_labor_hours?.toFixed(1) || "-"}
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

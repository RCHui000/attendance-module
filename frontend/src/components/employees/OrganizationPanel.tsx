import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Card } from "@/components/ui/card";
import { useDeleteOrganization, useOrganizations, useSaveOrganization } from "@/hooks/useEmployees";
import type { Employee, Organization } from "@/types/employee";
import { cn } from "@/lib/utils";
import { departmentColorOptions, departmentColorClass } from "@/lib/departmentColors";
import { descendantOrgIds, flattenOrgTree, orgOptionLabel } from "@/utils/orgTree";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

interface OrganizationPanelProps {
  employees: Employee[];
  canManage?: boolean;
  visibleOrgIds?: Set<number>;
}

export function OrganizationPanel({
  employees,
  canManage = true,
  visibleOrgIds,
}: OrganizationPanelProps) {
  const { data: orgs = [], isLoading } = useOrganizations();
  const saveOrg = useSaveOrganization();
  const deleteOrg = useDeleteOrganization();

  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editData, setEditData] = useState({
    orgName: "",
    orgType: "department" as "company" | "department",
    parentId: "" as string,
    managerIds: [] as string[],
    colorToken: "",
  });
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [expandedOrgIds, setExpandedOrgIds] = useState<Set<number>>(() => new Set());

  const directOrgMemberCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    employees.forEach((employee) => {
      if (employee.org_id) counts[employee.org_id] = (counts[employee.org_id] || 0) + 1;
    });
    return counts;
  }, [employees]);

  const treeOrgs = useMemo(() => flattenOrgTree(orgs), [orgs]);
  const orgById = useMemo(() => new Map(orgs.map((org) => [org.id, org])), [orgs]);
  const selectedOrg = editingId ? orgById.get(editingId) || null : null;

  const childIdsByParent = useMemo(() => {
    const map = new Map<number | null, number[]>();
    orgs.forEach((org) => {
      const parentId = org.parent_id ?? null;
      const children = map.get(parentId) || [];
      children.push(org.id);
      map.set(parentId, children);
    });
    return map;
  }, [orgs]);

  const orgMemberCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    orgs.forEach((org) => {
      let total = directOrgMemberCounts[org.id] || 0;
      descendantOrgIds(orgs, org.id).forEach((childId) => {
        total += directOrgMemberCounts[childId] || 0;
      });
      counts[org.id] = total;
    });
    return counts;
  }, [directOrgMemberCounts, orgs]);

  const visibleRows = useMemo(() => {
    const normalizedSearch = search.trim();
    const passesSearch = (org: (typeof treeOrgs)[number]) =>
      !normalizedSearch || org.path.includes(normalizedSearch) || org.org_name.includes(normalizedSearch);

    return treeOrgs.filter((org) => {
      if (visibleOrgIds && !visibleOrgIds.has(org.id)) return false;
      if (!passesSearch(org)) return false;
      if (normalizedSearch) return true;

      let parentId = org.parent_id;
      while (parentId) {
        if (!expandedOrgIds.has(parentId)) return false;
        parentId = orgById.get(parentId)?.parent_id ?? null;
      }
      return true;
    });
  }, [expandedOrgIds, orgById, search, treeOrgs, visibleOrgIds]);

  const parentOptions = useMemo(() => {
    const blocked = editingId ? descendantOrgIds(orgs, editingId) : new Set<number>();
    if (editingId) blocked.add(editingId);
    return treeOrgs.filter((org) => !blocked.has(org.id));
  }, [editingId, orgs, treeOrgs]);

  const managerOptions = useMemo(
    () => employees
      .filter((employee) => String(employee.status || "").toLowerCase() !== "terminated")
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    [employees],
  );

  const employeeById = useMemo(
    () => new Map(employees.map((employee) => [String(employee.id), employee])),
    [employees],
  );

  const isPmOrg = (org?: Organization | null, draftName = "") => {
    const text = `${org?.org_code || ""} ${org?.org_name || draftName}`.toUpperCase();
    return text.includes("PM") || text.includes("项目管理");
  };

  const allowMultipleManagers = isPmOrg(selectedOrg, editData.orgName);

  const startEdit = (org?: Organization) => {
    if (!canManage) return;
    if (org) {
      setIsNew(false);
      setEditingId(org.id);
      setEditData({
        orgName: org.org_name,
        orgType: org.org_type,
        parentId: org.parent_id ? String(org.parent_id) : "",
        managerIds: (org.manager_ids || []).map(String),
        colorToken: org.color_token || "",
      });
    } else {
      setIsNew(true);
      setEditingId(null);
      setEditData({ orgName: "", orgType: "department", parentId: "", managerIds: [], colorToken: "" });
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsNew(false);
  };

  const addManager = (value: string | null) => {
    if (!value || value === "none") return;
    setEditData((data) => {
      if (data.managerIds.includes(value)) return data;
      return {
        ...data,
        managerIds: allowMultipleManagers ? [...data.managerIds, value] : [value],
      };
    });
  };

  const removeManager = (id: string) => {
    setEditData((data) => ({
      ...data,
      managerIds: data.managerIds.filter((managerId) => managerId !== id),
    }));
  };

  const managerChipLabel = (id: string) => {
    const employee = employeeById.get(id);
    return employee ? `${employee.name} · ${employee.org_name || employee.department || "未分配部门"}` : id;
  };

  const managerSummary = (org: Organization) => {
    const names = org.manager_names || [];
    if (names.length === 0) return "未设置负责人";
    return names.join(" / ");
  };

  const renderEditForm = () => (
    <div className="space-y-2">
      <Input
        className="h-8 text-sm"
        value={editData.orgName}
        onChange={(event) => setEditData((data) => ({ ...data, orgName: event.target.value }))}
        placeholder="部门名称"
      />
      <Select
        value={editData.orgType}
        onValueChange={(value) => setEditData((data) => ({ ...data, orgType: value as "company" | "department" }))}
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="department">部门</SelectItem>
          <SelectItem value="company">公司</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={editData.parentId || "none"}
        onValueChange={(value) => setEditData((data) => ({ ...data, parentId: !value || value === "none" ? "" : value }))}
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="上级部门" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">无上级</SelectItem>
          {parentOptions.map((org) => (
            <SelectItem key={org.id} value={String(org.id)}>
              {orgOptionLabel(org)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="space-y-1.5 rounded-md border border-border bg-muted/20 p-2">
        <div className="text-xs font-medium text-muted-foreground">审批中心部门颜色</div>
        <div className="grid grid-cols-4 gap-1.5">
          {departmentColorOptions.map((option) => {
            const active = editData.colorToken === option.token;
            return (
              <button
                key={option.token || "none"}
                type="button"
                className={cn(
                  "inline-flex h-8 items-center justify-center gap-1 rounded-full border px-2 text-xs transition-[background-color,border-color,box-shadow] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
                  option.swatchClassName,
                  active && "border-primary shadow-focus",
                )}
                onClick={() => setEditData((data) => ({ ...data, colorToken: option.token }))}
              >
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {allowMultipleManagers ? "部门负责人" : "负责人"}
          </span>
        </div>
        <Select value="none" onValueChange={addManager}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={allowMultipleManagers ? "添加负责人" : "选择负责人"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">不设置</SelectItem>
            {managerOptions.map((employee) => (
              <SelectItem key={employee.id} value={String(employee.id)}>
                {employee.name} · {employee.org_name || employee.department || "未分配部门"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {editData.managerIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {editData.managerIds.map((id) => (
              <span
                key={id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              >
                <span className="max-w-36 truncate">{managerChipLabel(id)}</span>
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-slate-100 hover:text-foreground"
                  onClick={() => removeManager(id)}
                  aria-label="移除负责人"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-1">
        <Button size="sm" className="h-7" onClick={handleSave} disabled={saveOrg.isPending}>
          保存
        </Button>
        <Button size="sm" variant="outline" className="h-7" onClick={cancelEdit}>
          取消
        </Button>
      </div>
    </div>
  );

  const handleSave = () => {
    if (!editData.orgName.trim()) {
      toast.error("请输入部门名称");
      return;
    }
    saveOrg.mutate(
      {
        id: editingId ?? undefined,
        orgName: editData.orgName.trim(),
        orgType: editData.orgType,
        parentId: editData.parentId ? Number(editData.parentId) : null,
        managerIds: editData.managerIds.map(Number),
        colorToken: editData.colorToken || null,
      },
      {
        onSuccess: () => {
          toast.success(isNew ? "部门已创建" : "部门已更新");
          cancelEdit();
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "保存失败"),
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteOrg.mutate(deleteTarget, {
      onSuccess: () => toast.success("部门已删除"),
      onError: (error) => toast.error(error instanceof Error ? error.message : "删除失败"),
    });
    setDeleteTarget(null);
  };

  const toggleExpanded = (orgId: number) => {
    setExpandedOrgIds((current) => {
      const next = new Set(current);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  };

  return (
    <Card className="rounded-lg p-3.5 shadow-app">
      <div className="mb-3 flex items-center justify-between">
        <strong className="text-sm">部门列表</strong>
        {canManage && (
          <Button variant="outline" size="sm" onClick={() => startEdit()}>
            <Plus className="mr-1 size-3.5" />
            新增部门
          </Button>
        )}
      </div>

      <Input
        placeholder="搜索部门"
        className="mb-3 h-8 text-sm"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {isNew && (
        <div className="mb-3 rounded-md border border-dashed border-border bg-muted/25 px-3 py-2">
          {renderEditForm()}
        </div>
      )}

      {isLoading && (
        <div className="py-6 text-center text-sm text-muted-foreground">
          加载中...
        </div>
      )}

      <div className="grid max-h-[55vh] gap-2 overflow-auto">
        {visibleRows.map((org) => {
          const hasChildren = (childIdsByParent.get(org.id) || []).length > 0;
          const isExpanded = expandedOrgIds.has(org.id) || !!search.trim();
          return (
            <div
              key={org.id}
              className="rounded-md border border-border px-3 py-2 transition-colors hover:bg-row-hover"
            >
              {editingId === org.id ? (
                renderEditForm()
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center">
                    <span style={{ width: org.depth * 18 }} className="shrink-0" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn("mr-1 size-6 shrink-0 p-0", !hasChildren && "invisible")}
                      onClick={() => toggleExpanded(org.id)}
                    >
                      {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </Button>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        {org.color_token ? (
                          <span
                            className={cn(
                              "size-2.5 shrink-0 rounded-full border",
                              departmentColorClass(org.color_token),
                            )}
                            aria-hidden="true"
                          />
                        ) : null}
                        <div className="truncate text-sm font-medium">{org.org_name}</div>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {managerSummary(org)} · {orgMemberCounts[org.id] || 0}人
                      </div>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="size-7 p-0" onClick={() => startEdit(org)}>
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-7 p-0 text-destructive"
                        onClick={() => setDeleteTarget(org.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除部门？</AlertDialogTitle>
            <AlertDialogDescription>
              如果该部门下有员工或子部门，将无法删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

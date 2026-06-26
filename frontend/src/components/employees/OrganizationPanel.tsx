import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDeleteOrganization, useOrganizations, useSaveOrganization } from "@/hooks/useEmployees";
import { cn } from "@/lib/utils";
import { departmentColorClass, departmentColorLabel, departmentColorOptions, departmentSwatchClass } from "@/lib/departmentColors";
import { descendantOrgIds, effectiveOrgColorToken, flattenOrgTree, orgOptionLabel } from "@/utils/orgTree";
import type { Employee, Organization } from "@/types/employee";
import { toast } from "sonner";

interface OrganizationPanelProps {
  employees: Employee[];
  canManage?: boolean;
  visibleOrgIds?: Set<number>;
}

type OrganizationDraft = {
  orgName: string;
  orgType: "company" | "department";
  parentId: string;
  managerIds: string[];
  colorToken: string;
};

const EMPTY_DRAFT: OrganizationDraft = {
  orgName: "",
  orgType: "department",
  parentId: "",
  managerIds: [],
  colorToken: "",
};

const orgTypeLabels: Record<OrganizationDraft["orgType"], string> = {
  company: "公司",
  department: "部门",
};

function draftFromOrg(org: Organization): OrganizationDraft {
  return {
    orgName: org.org_name,
    orgType: org.org_type,
    parentId: org.parent_id ? String(org.parent_id) : "",
    managerIds: (org.manager_ids || []).map(String),
    colorToken: org.color_token || "",
  };
}

function ConfigSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-xs font-medium text-muted-foreground">{children}</label>;
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
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editData, setEditData] = useState<OrganizationDraft>(EMPTY_DRAFT);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [expandedOrgIds, setExpandedOrgIds] = useState<Set<number>>(() => new Set());
  const [isColorOpen, setIsColorOpen] = useState(false);

  const directOrgMemberCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    employees.forEach((employee) => {
      if (employee.org_id) counts[employee.org_id] = (counts[employee.org_id] || 0) + 1;
    });
    return counts;
  }, [employees]);

  const treeOrgs = useMemo(() => flattenOrgTree(orgs), [orgs]);
  const orgById = useMemo(() => new Map(orgs.map((org) => [org.id, org])), [orgs]);
  const selectedOrg = selectedOrgId ? orgById.get(selectedOrgId) || null : null;

  const visibleTreeOrgs = useMemo(
    () => treeOrgs.filter((org) => !visibleOrgIds || visibleOrgIds.has(org.id)),
    [treeOrgs, visibleOrgIds],
  );

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

  const effectiveColorByOrgId = useMemo(
    () => new Map(orgs.map((org) => [org.id, effectiveOrgColorToken(orgs, org.id)])),
    [orgs],
  );

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

    return visibleTreeOrgs.filter((org) => {
      if (!passesSearch(org)) return false;
      if (normalizedSearch) return true;

      let parentId = org.parent_id;
      while (parentId) {
        if (!expandedOrgIds.has(parentId)) return false;
        parentId = orgById.get(parentId)?.parent_id ?? null;
      }
      return true;
    });
  }, [expandedOrgIds, orgById, search, visibleTreeOrgs]);

  const parentOptions = useMemo(() => {
    const blocked = selectedOrgId && !isNew ? descendantOrgIds(orgs, selectedOrgId) : new Set<number>();
    if (selectedOrgId && !isNew) blocked.add(selectedOrgId);
    return visibleTreeOrgs.filter((org) => !blocked.has(org.id));
  }, [isNew, orgs, selectedOrgId, visibleTreeOrgs]);

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
  const inheritedColorToken = useMemo(() => {
    if (editData.colorToken) return "";
    if (isNew) return effectiveOrgColorToken(orgs, editData.parentId ? Number(editData.parentId) : null);
    return selectedOrg ? effectiveOrgColorToken(orgs, selectedOrg.id) : "";
  }, [editData.colorToken, editData.parentId, isNew, orgs, selectedOrg]);
  const displayColorToken = editData.colorToken || inheritedColorToken;
  const currentSwatchClass = departmentSwatchClass(displayColorToken);
  const currentColorLabel = editData.colorToken
    ? departmentColorLabel(editData.colorToken)
    : inheritedColorToken
      ? `继承：${departmentColorLabel(inheritedColorToken)}`
      : departmentColorLabel("");

  const selectOrg = (org: Organization) => {
    setIsNew(false);
    setSelectedOrgId(org.id);
    setEditData(draftFromOrg(org));
    setIsColorOpen(false);
  };

  const startNew = () => {
    if (!canManage) return;
    setIsNew(true);
    setSelectedOrgId(null);
    setEditData(EMPTY_DRAFT);
    setIsColorOpen(false);
  };

  const cancelEdit = () => {
    setIsNew(false);
    setIsColorOpen(false);
    if (selectedOrg) {
      setEditData(draftFromOrg(selectedOrg));
      return;
    }
    const firstOrg = visibleTreeOrgs[0];
    if (firstOrg) {
      setSelectedOrgId(firstOrg.id);
      setEditData(draftFromOrg(firstOrg));
    }
  };

  const addManager = (value: string | null) => {
    if (!value || value === "none" || !canManage) return;
    setEditData((data) => {
      if (data.managerIds.includes(value)) return data;
      return {
        ...data,
        managerIds: allowMultipleManagers ? [...data.managerIds, value] : [value],
      };
    });
  };

  const removeManager = (id: string) => {
    if (!canManage) return;
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

  const parentLabel = (parentId: string) => {
    if (!parentId) return "无上级";
    const parentTreeOrg = parentOptions.find((org) => String(org.id) === parentId);
    if (parentTreeOrg) return orgOptionLabel(parentTreeOrg);
    return orgById.get(Number(parentId))?.org_name || "无上级";
  };

  const handleSave = () => {
    if (!canManage) return;
    if (!editData.orgName.trim()) {
      toast.error("请输入部门名称");
      return;
    }

    saveOrg.mutate(
      {
        id: isNew ? undefined : selectedOrgId ?? undefined,
        orgName: editData.orgName.trim(),
        orgType: editData.orgType,
        parentId: editData.parentId ? Number(editData.parentId) : null,
        managerIds: editData.managerIds.map(Number),
        colorToken: editData.colorToken || null,
      },
      {
        onSuccess: (result) => {
          const nextId = typeof result === "object" && result && "organization_id" in result
            ? Number((result as { organization_id?: number }).organization_id)
            : selectedOrgId;
          toast.success(isNew ? "部门已创建" : "部门已更新");
          setIsNew(false);
          setIsColorOpen(false);
          if (nextId) setSelectedOrgId(nextId);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "保存失败"),
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteOrg.mutate(deleteTarget, {
      onSuccess: () => {
        toast.success("部门已删除");
        if (selectedOrgId === deleteTarget) {
          setSelectedOrgId(null);
          setEditData(EMPTY_DRAFT);
        }
      },
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

  const detailTitle = isNew ? "新增部门" : selectedOrg?.org_name || "选择部门";
  const detailDescription = isNew
    ? "填写基础信息后保存为新的组织节点。"
    : selectedOrg
      ? `${managerSummary(selectedOrg)} · ${orgMemberCounts[selectedOrg.id] || 0} 人`
      : "从左侧部门树选择一个部门进行配置。";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">组织配置</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            维护部门层级、负责人和审批中心部门识别色。
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={startNew}>
            <Plus className="mr-1 size-3.5" />
            新增部门
          </Button>
        )}
      </div>

      <div className="grid grid-cols-[minmax(280px,0.92fr)_minmax(420px,1.48fr)] gap-4 max-[900px]:grid-cols-1">
        <div className="rounded-lg border border-border bg-card p-3 shadow-app">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">部门树</div>
              <div className="text-xs text-muted-foreground">{visibleTreeOrgs.length} 个节点</div>
            </div>
          </div>

          <Input
            placeholder="搜索部门"
            className="mb-3 h-8 text-sm"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>
          ) : (
            <div className="grid max-h-[62vh] gap-1.5 overflow-auto pr-1">
              {visibleRows.map((org) => {
                const hasChildren = (childIdsByParent.get(org.id) || []).length > 0;
                const isExpanded = expandedOrgIds.has(org.id) || !!search.trim();
                const isSelected = selectedOrgId === org.id && !isNew;
                const effectiveColorToken = effectiveColorByOrgId.get(org.id) || "";
                return (
                  <button
                    key={org.id}
                    type="button"
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-lg border border-border/80 bg-card px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow] duration-150 hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
                      isSelected && "border-foreground/70 bg-row-selected shadow-focus",
                    )}
                    onClick={() => {
                      selectOrg(org);
                      if (hasChildren && !search.trim()) toggleExpanded(org.id);
                    }}
                  >
                    <span style={{ width: org.depth * 16 }} className="shrink-0" />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors group-hover:bg-muted",
                        !hasChildren && "invisible",
                      )}
                    >
                      {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </span>
                    {effectiveColorToken ? (
                      <span
                        className={cn("size-2.5 shrink-0 rounded-full border", departmentSwatchClass(effectiveColorToken))}
                        title={org.color_token ? departmentColorLabel(effectiveColorToken) : `继承 ${departmentColorLabel(effectiveColorToken)}`}
                        aria-hidden="true"
                      />
                    ) : (
                      <span className="size-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground/30" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{org.org_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {managerSummary(org)} · {orgMemberCounts[org.id] || 0} 人
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4 shadow-app">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold tracking-normal">{detailTitle}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{detailDescription}</p>
            </div>
            {!isNew && selectedOrg && displayColorToken ? (
              <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", departmentColorClass(displayColorToken))}>
                {editData.colorToken ? departmentColorLabel(displayColorToken) : `继承：${departmentColorLabel(displayColorToken)}`}
              </span>
            ) : null}
          </div>

          {!isNew && !selectedOrg ? (
            <div className="flex min-h-72 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              请选择一个部门
            </div>
          ) : (
            <div className="grid gap-3">
              <ConfigSection title="基础信息">
                <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
                  <div className="space-y-1.5">
                    <FieldLabel>部门名称</FieldLabel>
                    <Input
                      className="h-8 bg-card text-sm"
                      value={editData.orgName}
                      disabled={!canManage}
                      onChange={(event) => setEditData((data) => ({ ...data, orgName: event.target.value }))}
                      placeholder="部门名称"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel>部门类型</FieldLabel>
                    <Select
                      value={editData.orgType}
                      disabled={!canManage}
                      onValueChange={(value) => setEditData((data) => ({ ...data, orgType: value as "company" | "department" }))}
                    >
                      <SelectTrigger className="h-8 w-full bg-card text-sm">
                        <SelectValue>{orgTypeLabels[editData.orgType]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="department">部门</SelectItem>
                        <SelectItem value="company">公司</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>上级部门</FieldLabel>
                  <Select
                    value={editData.parentId || "none"}
                    disabled={!canManage}
                    onValueChange={(value) => setEditData((data) => ({ ...data, parentId: !value || value === "none" ? "" : value }))}
                  >
                    <SelectTrigger className="h-8 w-full bg-card text-sm">
                      <SelectValue>{parentLabel(editData.parentId)}</SelectValue>
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
                </div>
              </ConfigSection>

              <ConfigSection title={allowMultipleManagers ? "部门负责人" : "负责人"}>
                <Select value="none" disabled={!canManage} onValueChange={addManager}>
                  <SelectTrigger className="h-8 w-full bg-card text-sm">
                    <SelectValue>{allowMultipleManagers ? "添加负责人" : "选择负责人"}</SelectValue>
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
                {editData.managerIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {editData.managerIds.map((id) => (
                      <span
                        key={id}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs text-foreground"
                      >
                        <span className="max-w-56 truncate">{managerChipLabel(id)}</span>
                        {canManage && (
                          <button
                            type="button"
                            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => removeManager(id)}
                            aria-label="移除负责人"
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                    暂未设置负责人
                  </div>
                )}
              </ConfigSection>

              <ConfigSection title="显示设置">
                <div className="relative">
                  <FieldLabel>部门颜色</FieldLabel>
                  <button
                    type="button"
                    disabled={!canManage}
                    className={cn(
                      "mt-1 flex h-8 w-full items-center justify-between rounded-lg border border-input bg-card px-2.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60",
                    )}
                    onClick={() => setIsColorOpen((open) => !open)}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "size-3 rounded-full border",
                          currentSwatchClass || "border-dashed border-muted-foreground/40 bg-card",
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate">{currentColorLabel}</span>
                    </span>
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  </button>
                  {isColorOpen && canManage && (
                    <div className="absolute z-dropdown mt-2 w-full rounded-lg border border-border bg-popover p-2 shadow-float">
                      <div className="grid grid-cols-4 gap-1.5 max-[520px]:grid-cols-2">
                        {departmentColorOptions.map((option) => {
                          const active = editData.colorToken === option.token;
                          const swatchClass = option.token ? departmentColorClass(option.token) : "";
                          const dotClass = option.token ? departmentSwatchClass(option.token) : "";
                          return (
                            <button
                              key={option.token || "none"}
                              type="button"
                              className={cn(
                                "inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-2 text-xs transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:transition-none",
                                swatchClass || option.swatchClassName,
                                active && "border-foreground shadow-focus",
                              )}
                              onClick={() => {
                                setEditData((data) => ({ ...data, colorToken: option.token }));
                                setIsColorOpen(false);
                              }}
                            >
                              <span
                                className={cn(
                                  "size-2.5 rounded-full border",
                                  dotClass || "border-dashed border-muted-foreground/40 bg-card",
                                )}
                                aria-hidden="true"
                              />
                              <span className="truncate">{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </ConfigSection>

              {canManage && (
                <div className="flex flex-wrap justify-between gap-2 pt-1">
                  <div>
                    {!isNew && selectedOrg && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(selectedOrg.id)}
                      >
                        <Trash2 className="mr-1 size-3.5" />
                        删除部门
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={cancelEdit}>
                      取消
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={saveOrg.isPending}>
                      保存配置
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
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
    </section>
  );
}

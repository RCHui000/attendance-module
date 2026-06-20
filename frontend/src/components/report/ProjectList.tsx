import { useEffect, useMemo, useState } from "react";
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
import { useProjectBase, useSaveProject, useDeleteProject, useProjectRoleRequirements } from "@/hooks/useReport";
import { useEmployees, useOrganizations } from "@/hooks/useEmployees";
import { api } from "@/lib/api";
import { formatMoney } from "@/utils/dates";
import { cn } from "@/lib/utils";
import { descendantOrgIds } from "@/utils/orgTree";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { Save, Search, Trash2, X, Plus } from "lucide-react";
import type { Employee, Organization } from "@/types/employee";
import type { ProjectBase, ProjectBusinessType, ProjectRoleKey, ProjectRoleRequirement } from "@/types/project";
import { toast } from "sonner";

const NONE = "none";
const serviceTypes: ProjectBusinessType[] = ["PM", "CC", "PMCC"];

const ccRoleKeys = new Set<ProjectRoleKey>([
  "cc_civil_project_owner",
  "cc_mep_project_owner",
  "cc_project_owner",
  "cc_department_owner",
]);

function normalizedOrgName(org?: Organization | null) {
  return `${org?.org_code || ""} ${org?.org_name || ""}`.toUpperCase();
}

function findOrgId(orgs: Organization[], matcher: (org: Organization) => boolean) {
  return orgs.find(matcher)?.id ?? null;
}

function orgScopeIds(orgs: Organization[], rootId: number | null) {
  if (!rootId) return new Set<number>();
  const ids = descendantOrgIds(orgs, rootId);
  ids.add(rootId);
  return ids;
}

function orgScopes(orgs: Organization[], matcher: (org: Organization) => boolean) {
  const ids = new Set<number>();
  orgs.filter(matcher).forEach((org) => {
    orgScopeIds(orgs, org.id).forEach((id) => ids.add(id));
  });
  return ids;
}

function roleOrgScope(role: ProjectRoleKey, orgs: Organization[]) {
  const pmRoot = findOrgId(orgs, (org) => {
    const text = normalizedOrgName(org);
    return (text.includes("PM") || org.org_name.includes("项目管理")) && !org.parent_id;
  });
  const pmCost = findOrgId(orgs, (org) => org.org_code === "PM_COST" || org.org_name === "成本");
  const pmManage = findOrgId(orgs, (org) => org.org_code === "PM_MANAGE" || org.org_name === "管理");

  if (ccRoleKeys.has(role)) {
    return orgScopes(orgs, (org) => {
      const text = normalizedOrgName(org);
      return text.includes("CC") || org.org_name.includes("造价");
    });
  }
  if (role === "pm_cost_department_owner") return orgScopeIds(orgs, pmCost || pmRoot);
  if (role === "pm_project_owner") return orgScopeIds(orgs, pmManage || pmRoot);
  if (role === "pm_department_owner") return orgScopeIds(orgs, pmRoot);
  return new Set<number>();
}

function isActiveEmployee(employee: Employee) {
  return String(employee.status || "").toLowerCase() !== "terminated";
}

function employeeMatchesRole(employee: Employee, role: ProjectRoleKey, scope: Set<number>) {
  if (!isActiveEmployee(employee)) return false;
  if (scope.size > 0 && (!employee.org_id || !scope.has(employee.org_id))) return false;
  if (role === "cc_civil_project_owner") {
    return employee.cost_specialty === "civil" || employee.cost_specialty === "all" || !employee.cost_specialty;
  }
  if (role === "cc_mep_project_owner") {
    return employee.cost_specialty === "mep" || employee.cost_specialty === "all" || !employee.cost_specialty;
  }
  return true;
}

type EditData = {
  id?: number;
  code: string;
  name: string;
  signedDate: string;
  businessType: ProjectBusinessType | "";
  contractAmount: string;
  receivedAmount: string;
  roles: Record<string, string>;
};

const emptyEditData: EditData = {
  code: "",
  name: "",
  signedDate: "",
  businessType: "",
  contractAmount: "",
  receivedAmount: "",
  roles: {},
};

function inferBusinessType(code: string): ProjectBusinessType | "" {
  const normalized = code.trim().toUpperCase();
  if (normalized.startsWith("PMCC")) return "PMCC";
  if (normalized.startsWith("PM")) return "PM";
  if (normalized.startsWith("CC")) return "CC";
  return "";
}

function projectRoleRequirementsFor(
  businessType: ProjectBusinessType | "",
  requirements: ProjectRoleRequirement[],
) {
  if (!businessType) return [];
  return requirements.filter((requirement) => requirement.business_type === businessType);
}

function roleValues(
  project: ProjectBase | null,
  roleKey: ProjectRoleKey,
  fallbackRoleKey?: ProjectRoleKey | null,
) {
  const roles = project?.project_roles || [];
  const direct = roles.find((role) => role.role_key === roleKey && role.user_id);
  if (direct) return String(direct.user_id);
  if (fallbackRoleKey) {
    const legacy = roles.find((role) => role.role_key === fallbackRoleKey && role.user_id);
    if (legacy) return String(legacy.user_id);
  }
  return "";
}

function serviceBadgeClass(type: ProjectBusinessType | "") {
  if (type === "PM") return "border-sky-200 bg-sky-50 text-sky-700";
  if (type === "CC") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (type === "PMCC") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-border bg-muted text-muted-foreground";
}

function projectSummary(project: ProjectBase, roleRequirements: ProjectRoleRequirement[]) {
  const businessType = project.business_type || inferBusinessType(project.code);
  const requirements = projectRoleRequirementsFor(businessType, roleRequirements);
  const names = new Map<string, string[]>();
  for (const role of project.project_roles || []) {
    const list = names.get(role.role_key) || [];
    list.push(role.user_name || "未配置");
    names.set(role.role_key, list);
  }
  return requirements
    .flatMap((requirement) => names.get(requirement.role_key) || (requirement.fallback_role_key ? names.get(requirement.fallback_role_key) || [] : ["未配置"]))
    .filter(Boolean)
    .slice(0, 3)
    .join(" / ");
}

export function ProjectList() {
  const isMobile = useIsMobile();
  const { data: projects = [], isLoading, isError } = useProjectBase();
  const { data: employees = [] } = useEmployees();
  const { data: orgs = [] } = useOrganizations();
  const saveProject = useSaveProject();
  const deleteProject = useDeleteProject();
  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [editData, setEditData] = useState<EditData>(emptyEditData);
  const [autoProjectCode, setAutoProjectCode] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectBase | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  const activeProjects = useMemo(
    () => projects.filter((project) => project.status !== "deleted"),
    [projects],
  );
  const selectedProject = selectedId === "new" ? null : activeProjects.find((project) => project.id === selectedId) || null;
  const businessType = editData.businessType || inferBusinessType(editData.code);
  const { data: roleRequirements = [] } = useProjectRoleRequirements(businessType || null);
  const { data: allRoleRequirements = [] } = useProjectRoleRequirements();
  const visibleRoles = useMemo(
    () => roleRequirements.map((requirement) => requirement.role_key),
    [roleRequirements],
  );
  const roleLabels = useMemo(
    () => Object.fromEntries(
      roleRequirements.map((requirement) => [requirement.role_key, requirement.role_label]),
    ) as Record<ProjectRoleKey, string>,
    [roleRequirements],
  );
  const directoryProjects = useMemo(() => {
    const keyword = projectSearch.trim().toLowerCase();
    return activeProjects
      .filter((project) => {
        if (!keyword) return true;
        const type = project.business_type || inferBusinessType(project.code);
        const text = [
          project.code,
          project.name,
          type,
          projectSummary(project, allRoleRequirements),
        ].join(" ").toLowerCase();
        return text.includes(keyword);
      })
      .sort((a, b) => a.code.localeCompare(b.code, "zh-CN", { numeric: true }));
  }, [activeProjects, allRoleRequirements, projectSearch]);
  const employeeById = useMemo(() => new Map(employees.map((employee) => [String(employee.id), employee])), [employees]);

  const roleCandidates = (role: ProjectRoleKey) => {
    const scope = roleOrgScope(role, orgs);
    const selected = editData.roles[role] ? [editData.roles[role]] : [];
    const candidates = employees
      .filter((employee) => employeeMatchesRole(employee, role, scope))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    const selectedEmployees = selected
      .map((id) => employeeById.get(id))
      .filter((employee): employee is Employee => Boolean(employee))
      .filter((employee) => !candidates.some((candidate) => candidate.id === employee.id));
    return [...selectedEmployees, ...candidates];
  };

  const employeeLabel = (employee?: Employee) => {
    if (!employee) return "未配置";
    return `${employee.name} · ${employee.org_name || employee.department || "未分配部门"}`;
  };

  const selectProject = (project: ProjectBase) => {
    const type = project.business_type || inferBusinessType(project.code);
    const roles: Record<string, string> = {};
    for (const requirement of projectRoleRequirementsFor(type, allRoleRequirements)) {
      roles[requirement.role_key] = roleValues(project, requirement.role_key, requirement.fallback_role_key);
    }
    setSelectedId(project.id);
    setAutoProjectCode(null);
    setEditData({
      id: project.id,
      code: project.code,
      name: project.name,
      signedDate: project.signed_date || "",
      businessType: type,
      contractAmount: String(project.contract_amount || ""),
      receivedAmount: String(project.received_amount || ""),
      roles,
    });
    if (isMobile) setEditorOpen(true);
  };

  const startNew = () => {
    setSelectedId("new");
    setAutoProjectCode(null);
    setEditData(emptyEditData);
    if (isMobile) setEditorOpen(true);
  };

  const update = (patch: Partial<EditData>) => setEditData((data) => ({ ...data, ...patch }));
  const updateCode = (code: string) => {
    setAutoProjectCode(null);
    update({ code, businessType: editData.businessType || inferBusinessType(code) });
  };
  const updateBusinessType = (value: string | null) => {
    update({ businessType: value === NONE ? "" : (value as ProjectBusinessType) });
  };
  const updateRole = (role: ProjectRoleKey, value: string) =>
    setEditData((data) => {
      const nextValue = value === NONE ? "" : value;
      return { ...data, roles: { ...data.roles, [role]: nextValue } };
    });

  useEffect(() => {
    if (selectedId !== "new" || !editData.businessType) return;
    if (editData.code && editData.code !== autoProjectCode) return;

    let cancelled = false;
    api<{ code: string }>(`/api/numbering/project?businessType=${encodeURIComponent(editData.businessType)}`)
      .then((result) => {
        if (cancelled || !result.code) return;
        setAutoProjectCode(result.code);
        setEditData((data) => {
          if (data.code && data.code !== autoProjectCode) return data;
          return { ...data, code: result.code };
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [autoProjectCode, editData.businessType, editData.code, selectedId]);

  const handleSave = () => {
    if (!editData.name.trim()) return toast.error("项目名称不能为空");
    if (!businessType) return toast.error("请选择服务类型");
    if (selectedId !== "new" && !editData.code.trim()) return toast.error("合同编码不能为空");

    const projectRoles = visibleRoles
      .map((roleKey) => ({
        role_key: roleKey,
        user_id: Number(editData.roles[roleKey] || 0),
      }))
      .filter((role) => role.user_id);
    for (const requirement of roleRequirements) {
      if (!requirement.fallback_role_key) continue;
      if (projectRoles.some((role) => role.role_key === requirement.fallback_role_key)) continue;
      const fallbackUserId = Number(editData.roles[requirement.role_key] || 0);
      if (fallbackUserId) {
        projectRoles.push({
          role_key: requirement.fallback_role_key,
          user_id: fallbackUserId,
        });
      }
    }

    saveProject.mutate(
      {
        id: selectedId === "new" ? undefined : editData.id,
        code: editData.code.trim(),
        name: editData.name.trim(),
        signedDate: editData.signedDate || undefined,
        businessType,
        contractAmount: Number(editData.contractAmount || 0),
        receivedAmount: Number(editData.receivedAmount || 0),
        projectOwnerId:
          Number(editData.roles.pm_project_owner || 0) ||
          Number(editData.roles.cc_civil_project_owner || 0) ||
          Number(editData.roles.cc_mep_project_owner || 0) ||
          undefined,
        projectRoles,
      },
      {
        onSuccess: () => {
          toast.success(selectedId === "new" ? "项目已创建" : "项目已更新");
          setSelectedId(null);
          setAutoProjectCode(null);
          setEditData(emptyEditData);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "保存失败"),
      },
    );
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    deleteProject.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("项目已删除");
        if (selectedId === deleteTarget.id) {
          setSelectedId(null);
          setAutoProjectCode(null);
          setEditData(emptyEditData);
        }
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : "删除失败"),
    });
    setDeleteTarget(null);
  };

  if (isLoading) return <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>;
  if (isError) return <div className="py-10 text-center text-sm text-destructive">项目加载失败</div>;

  return (
    <div className="grid min-h-[68vh] grid-cols-[360px_minmax(0,1fr)] gap-4 max-[767px]:block">
      <div className="rounded-lg border border-border bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <div>
            <div className="text-sm font-semibold">项目目录</div>
            <div className="text-xs text-muted-foreground">{directoryProjects.length} / {activeProjects.length} 项</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={startNew}>
              <Plus className="mr-1 size-3.5" />
              新增
            </Button>
          </div>
        </div>
        <div className="border-b border-border p-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-sm"
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              placeholder="搜索合同编码、项目名称、服务类型、负责人"
            />
          </label>
        </div>
        <div className="max-h-[68vh] overflow-y-auto p-2 max-[767px]:max-h-none">
          {directoryProjects.map((project) => {
            const type = project.business_type || inferBusinessType(project.code);
            return (
              <button
                key={project.id}
                type="button"
                className={cn(
                  "mb-2 w-full rounded-md border border-transparent p-3 text-left transition-colors hover:border-border hover:bg-muted/40",
                  selectedId === project.id && "border-border bg-muted",
                )}
                onClick={() => selectProject(project)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{project.code}</span>
                  <span className={cn("rounded border px-2 py-0.5 text-xs", serviceBadgeClass(type))}>
                    {type || "-"}
                  </span>
                </div>
                <div className="mt-1 truncate text-sm">{project.name}</div>
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{projectSummary(project, allRoleRequirements) || "未配置负责人"}</div>
              </button>
            );
          })}
          {directoryProjects.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">没有匹配的项目</div>
          )}
        </div>
      </div>

      {isMobile && selectedId && editorOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
          aria-label="关闭项目配置"
          onClick={() => setEditorOpen(false)}
        />
      )}

      <div
        className={cn(
          "rounded-lg border border-border bg-white p-4",
          "max-[767px]:fixed max-[767px]:inset-x-3 max-[767px]:top-6 max-[767px]:bottom-6 max-[767px]:z-50 max-[767px]:overflow-y-auto max-[767px]:shadow-xl",
          (!isMobile || (selectedId && editorOpen)) ? "" : "max-[767px]:hidden",
        )}
      >
        {!selectedId && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            选择左侧项目，或新建项目后维护配置
          </div>
        )}
        {selectedId && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold">{selectedId === "new" ? "新增项目" : "项目配置"}</div>
                <div className="text-xs text-muted-foreground">服务类型决定合同审批模板和负责人路由</div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hidden max-[767px]:inline-flex"
                  onClick={() => setEditorOpen(false)}
                  aria-label="关闭项目配置"
                >
                  <X className="size-4" />
                </Button>
                {selectedProject && (
                  <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(selectedProject)}>
                    <Trash2 className="mr-1 size-3.5" />
                    删除
                  </Button>
                )}
                <Button size="sm" onClick={handleSave} disabled={saveProject.isPending}>
                  <Save className="mr-1 size-3.5" />
                  保存
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-[150px_150px_minmax(0,1fr)] gap-3">
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">合同编码</span>
                <Input
                  value={editData.code}
                  onChange={(event) => updateCode(event.target.value)}
                  placeholder="PM26001"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">服务类型</span>
                <Select value={businessType || NONE} onValueChange={updateBusinessType}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择服务类型" />
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
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">项目名称</span>
                <Input value={editData.name} onChange={(event) => update({ name: event.target.value })} />
              </label>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold">负责人配置</div>
              <div className="grid grid-cols-2 gap-3">
                {visibleRoles.map((role) => {
                  const userId = editData.roles[role] || "";
                  return (
                    <div key={role} className="space-y-2 text-sm">
                      <span className="text-xs font-medium text-muted-foreground">{roleLabels[role]}</span>
                      <Select value={userId || NONE} onValueChange={(value) => updateRole(role, value || NONE)}>
                        <SelectTrigger>
                          {userId ? employeeLabel(employeeById.get(userId)) : <SelectValue placeholder={roleLabels[role]} />}
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>未配置</SelectItem>
                          {roleCandidates(role).map((employee) => (
                            <SelectItem key={employee.id} value={String(employee.id)}>
                              {employeeLabel(employee)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">签订日期</span>
                <Input type="date" value={editData.signedDate} onChange={(event) => update({ signedDate: event.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">合同额</span>
                <Input type="number" value={editData.contractAmount} onChange={(event) => update({ contractAmount: event.target.value })} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">已回款</span>
                <Input type="number" value={editData.receivedAmount} onChange={(event) => update({ receivedAmount: event.target.value })} />
              </label>
              <div className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">待回款</span>
                <div className="rounded-md border border-border px-3 py-2 text-sm tabular-nums">
                  {formatMoney(Math.max(Number(editData.contractAmount || 0) - Number(editData.receivedAmount || 0), 0))}
                </div>
              </div>
            </div>

            {selectedProject && (
              <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">累计支出</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(selectedProject.total_labor_cost)}</div>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">累计工日</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{selectedProject.total_labor_hours?.toFixed(2) || "-"}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除项目</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除 {deleteTarget?.code} {deleteTarget?.name}？历史工时数据会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

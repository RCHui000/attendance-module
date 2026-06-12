import { useState, useMemo } from "react";
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
import { useOrganizations, useSaveOrganization, useDeleteOrganization } from "@/hooks/useEmployees";
import type { Employee, Organization } from "@/types/employee";
import { descendantOrgIds, flattenOrgTree, orgOptionLabel } from "@/utils/orgTree";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Pencil, Trash2, Plus } from "lucide-react";
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
    managerUserId: "" as string,
  });
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [expandedOrgIds, setExpandedOrgIds] = useState<Set<number>>(() => new Set());

  const directOrgMemberCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    employees.forEach((e) => {
      if (e.org_id) counts[e.org_id] = (counts[e.org_id] || 0) + 1;
    });
    return counts;
  }, [employees]);

  const treeOrgs = useMemo(() => flattenOrgTree(orgs), [orgs]);
  const orgById = useMemo(() => new Map(orgs.map((org) => [org.id, org])), [orgs]);
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
    const passesSearch = (org: typeof treeOrgs[number]) =>
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
    () =>
      employees.filter((e) => {
        if (String(e.status || "").toLowerCase() === "terminated") return false;
        if (e.role !== "manager" && e.role !== "admin") return false;
        return true;
      }),
    [employees],
  );

  // Get manager name
  const getManagerName = (managerId: number | null) => {
    if (!managerId) return "—";
    const emp = employees.find((e) => e.id === managerId);
    return emp?.name || "—";
  };

  const startEdit = (org?: Organization) => {
    if (!canManage) return;
    if (org) {
      setIsNew(false);
      setEditingId(org.id);
      setEditData({
        orgName: org.org_name,
        orgType: org.org_type,
        parentId: org.parent_id ? String(org.parent_id) : "",
        managerUserId: org.manager_user_id ? String(org.manager_user_id) : "",
      });
    } else {
      setIsNew(true);
      setEditData({ orgName: "", orgType: "department", parentId: "", managerUserId: "" });
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsNew(false);
  };

  const renderEditForm = () => (
    <div className="space-y-2">
      <Input
        className="h-8 text-sm"
        value={editData.orgName}
        onChange={(e) =>
          setEditData((d) => ({ ...d, orgName: e.target.value }))
        }
        placeholder="部门名称"
      />
      <Select
        value={editData.orgType}
        onValueChange={(v) =>
          setEditData((d) => ({ ...d, orgType: v as "company" | "department" }))
        }
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
        onValueChange={(v) =>
          setEditData((d) => ({ ...d, parentId: !v || v === "none" ? "" : v }))
        }
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
      <Select
        value={editData.managerUserId || "none"}
        onValueChange={(v) =>
          setEditData((d) => ({ ...d, managerUserId: !v || v === "none" ? "" : v }))
        }
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="选择负责人" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">无</SelectItem>
          {managerOptions.map((e) => (
            <SelectItem key={e.id} value={String(e.id)}>
              {e.name} · {e.org_name || e.department || "未分配部门"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-1 justify-end">
        <Button
          size="sm"
          className="h-7"
          onClick={handleSave}
          disabled={saveOrg.isPending}
        >
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
        managerUserId: editData.managerUserId ? Number(editData.managerUserId) : null,
      },
      {
        onSuccess: () => {
          toast.success(isNew ? "部门已创建" : "部门已更新");
          cancelEdit();
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "保存失败"),
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteOrg.mutate(deleteTarget, {
      onSuccess: () => toast.success("部门已删除"),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "删除失败"),
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
    <Card className="p-3.5 shadow-app rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <strong className="text-sm">部门列表</strong>
        {canManage && (
          <Button variant="outline" size="sm" onClick={() => startEdit()}>
            <Plus className="size-3.5 mr-1" />
            新增部门
          </Button>
        )}
      </div>

      <Input
        placeholder="搜索部门…"
        className="mb-3 h-8 text-sm"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {isNew && (
        <div className="mb-3 rounded-md border border-dashed border-border bg-muted/25 px-3 py-2">
          {renderEditForm()}
        </div>
      )}

      {isLoading && (
        <div className="py-6 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      )}

      <div className="grid gap-2 max-h-[55vh] overflow-auto">
        {visibleRows.map((org) => {
          const hasChildren = (childIdsByParent.get(org.id) || []).length > 0;
          const isExpanded = expandedOrgIds.has(org.id) || !!search.trim();
          return (
          <div
            key={org.id}
            className="rounded-md border border-border px-3 py-2 hover:bg-row-hover transition-colors"
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
                  <span className="truncate text-sm font-medium">{org.org_name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {getManagerName(org.manager_user_id)} ·{" "}
                    {orgMemberCounts[org.id] || 0}人
                  </span>
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-7 p-0"
                      onClick={() => startEdit(org)}
                    >
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

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget != null} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
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

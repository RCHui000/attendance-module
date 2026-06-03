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
import { Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

interface OrganizationPanelProps {
  employees: Employee[];
}

export function OrganizationPanel({ employees }: OrganizationPanelProps) {
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

  // Count employees per org
  const orgMemberCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    employees.forEach((e) => {
      if (e.org_id) counts[e.org_id] = (counts[e.org_id] || 0) + 1;
    });
    return counts;
  }, [employees]);

  const filtered = orgs.filter((o) =>
    o.org_name.includes(search),
  );

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

  return (
    <Card className="p-3.5 shadow-app rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <strong className="text-sm">部门列表</strong>
        <Button variant="outline" size="sm" onClick={() => startEdit()}>
          <Plus className="size-3.5 mr-1" />
          新增部门
        </Button>
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
        {filtered.map((org) => (
          <div
            key={org.id}
            className="rounded-md border border-border px-3 py-2 hover:bg-row-hover transition-colors"
          >
            {editingId === org.id ? (
              renderEditForm()
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{org.org_name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {getManagerName(org.manager_user_id)} ·{" "}
                    {orgMemberCounts[org.id] || 0}人
                  </span>
                </div>
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
              </div>
            )}
          </div>
        ))}
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

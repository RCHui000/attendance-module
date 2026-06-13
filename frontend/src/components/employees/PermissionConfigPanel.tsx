import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermissionConfig, useSavePermissionConfig } from "@/hooks/useEmployees";
import { cn } from "@/lib/utils";
import type { PermissionAccess } from "@/types/auth";
import { toast } from "sonner";

const accessText: Record<PermissionAccess, string> = {
  none: "不可见",
  read: "只读",
  write: "编辑",
};

const accessTone: Record<PermissionAccess, string> = {
  none: "border-slate-200 bg-slate-50 text-slate-500",
  read: "border-sky-200 bg-sky-50 text-sky-700",
  write: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

interface PermissionConfigPanelProps {
  canWrite: boolean;
}

export function PermissionConfigPanel({ canWrite }: PermissionConfigPanelProps) {
  const { data, isLoading, isError } = usePermissionConfig();
  const saveConfig = useSavePermissionConfig();
  const roles = data?.roles || [];
  const resources = data?.resources || [];
  const [selectedRole, setSelectedRole] = useState("");
  const activeRole = selectedRole || roles[0]?.role_key || "";

  const matrix = useMemo(() => {
    const map = new Map<string, PermissionAccess>();
    for (const permission of data?.permissions || []) {
      map.set(`${permission.role_key}:${permission.resource_key}`, permission.access_level);
    }
    return map;
  }, [data?.permissions]);

  const groupedResources = useMemo(() => {
    const groups = new Map<string, typeof resources>();
    for (const resource of resources) {
      const group = resource.resource_group === "employee_org" ? "员工与组织" : "侧边栏";
      groups.set(group, [...(groups.get(group) || []), resource]);
    }
    return Array.from(groups.entries());
  }, [resources]);

  const setAccess = async (resourceKey: string, accessLevel: PermissionAccess) => {
    if (!canWrite || !activeRole) return;
    try {
      await saveConfig.mutateAsync({
        roleKey: activeRole,
        permissions: [{ resourceKey, accessLevel }],
      });
      toast.success("权限配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "权限保存失败");
    }
  };

  if (isLoading) return <div className="py-10 text-sm text-muted-foreground">加载权限配置中…</div>;
  if (isError) return <div className="py-10 text-sm text-destructive">权限配置加载失败</div>;

  return (
    <div className="grid grid-cols-[260px_1fr] gap-4 max-[900px]:grid-cols-1">
      <aside className="rounded-lg border border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <strong className="text-sm">权限角色</strong>
        </div>
        <div className="p-2">
          {roles.map((role) => (
            <button
              key={role.role_key}
              type="button"
              className={cn(
                "mb-1 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
                activeRole === role.role_key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
              onClick={() => setSelectedRole(role.role_key)}
            >
              <span>{role.role_name}</span>
              <span className="text-xs opacity-75">{role.role_key}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="rounded-lg border border-border bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <strong className="text-sm">
              {roles.find((role) => role.role_key === activeRole)?.role_name || "权限详情"}
            </strong>
          </div>
          <Badge variant="outline" className="rounded-pill">
            {canWrite ? "可编辑" : "只读"}
          </Badge>
        </div>

        <div className="divide-y divide-border">
          {groupedResources.map(([group, items]) => (
            <div key={group} className="p-4">
              <div className="mb-2 text-xs font-bold text-muted-foreground">{group}</div>
              <div className="grid gap-2">
                {items.map((resource) => {
                  const value = matrix.get(`${activeRole}:${resource.resource_key}`) || "none";
                  return (
                    <div
                      key={resource.resource_key}
                      className="grid grid-cols-[1fr_120px_140px] items-center gap-3 rounded-md border border-border px-3 py-2 max-[720px]:grid-cols-1"
                    >
                      <div>
                        <div className="text-sm font-medium">{resource.resource_name}</div>
                        <div className="text-xs text-muted-foreground">{resource.resource_key}</div>
                      </div>
                      <Badge variant="outline" className={cn("w-fit rounded-pill", accessTone[value])}>
                        {accessText[value]}
                      </Badge>
                      <Select value={value} disabled={!canWrite} onValueChange={(next) => setAccess(resource.resource_key, next as PermissionAccess)}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">不可见</SelectItem>
                          <SelectItem value="read">只读</SelectItem>
                          <SelectItem value="write">编辑</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {canWrite && (
          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            修改会立即保存；重新登录或刷新页面后侧边栏与页面入口按新权限生效。
          </div>
        )}
      </section>
    </div>
  );
}

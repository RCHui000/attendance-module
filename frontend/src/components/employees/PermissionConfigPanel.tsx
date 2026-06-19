import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GripVertical, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermissionConfig, useSavePermissionConfig } from "@/hooks/useEmployees";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import type { PermissionAccess } from "@/types/auth";
import type { PermissionResource } from "@/types/employee";
import { toast } from "sonner";

type PermissionListItem = PermissionResource & {
  displayGroup: "sidebar" | "employee_org";
  displayName?: string;
};

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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") return serialized;
  } catch {
    // Keep a stable fallback for empty or unserializable error objects.
  }
  return "权限保存失败，请查看服务端日志";
}

interface PermissionConfigPanelProps {
  canWrite: boolean;
}

export function PermissionConfigPanel({ canWrite }: PermissionConfigPanelProps) {
  const { data, isLoading, isError } = usePermissionConfig();
  const saveConfig = useSavePermissionConfig();
  const { user, sidebarOrder, setSidebarOrder } = useAuthStore();
  const roles = data?.roles || [];
  const resources = data?.resources || [];
  const [selectedRole, setSelectedRole] = useState("");
  const [draggingResourceKey, setDraggingResourceKey] = useState<string | null>(null);
  const [dragOverResourceKey, setDragOverResourceKey] = useState<string | null>(null);
  const [sidebarOrderPreview, setSidebarOrderPreview] = useState<string[] | null>(null);
  const sidebarItemRefs = useRef(new Map<string, HTMLDivElement>());
  const sidebarItemRects = useRef(new Map<string, DOMRect>());
  const didDropRef = useRef(false);
  const activeRole = selectedRole || roles[0]?.role_key || "";

  const matrix = useMemo(() => {
    const map = new Map<string, PermissionAccess>();
    for (const permission of data?.permissions || []) {
      map.set(`${permission.role_key}:${permission.resource_key}`, permission.access_level);
    }
    return map;
  }, [data?.permissions]);

  const permissionDetails = useMemo(() => {
    const map = new Map<string, { accessLevel: PermissionAccess; sidebarOrder: number }>();
    for (const permission of data?.permissions || []) {
      map.set(`${permission.role_key}:${permission.resource_key}`, {
        accessLevel: permission.access_level,
        sidebarOrder: Number(permission.sidebar_order || 0),
      });
    }
    return map;
  }, [data?.permissions]);

  const baseSidebarResources = useMemo(
    () =>
      resources
        .filter((resource) => resource.resource_group === "sidebar")
        .sort((a, b) => sidebarSortOrder(activeRole, a, permissionDetails) - sidebarSortOrder(activeRole, b, permissionDetails)),
    [activeRole, permissionDetails, resources],
  );

  const sidebarResources = useMemo(() => {
    if (!sidebarOrderPreview) return baseSidebarResources;

    const order = new Map(sidebarOrderPreview.map((resourceKey, index) => [resourceKey, index]));
    return [...baseSidebarResources].sort((a, b) => {
      const aOrder = order.get(a.resource_key) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = order.get(b.resource_key) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return sidebarSortOrder(activeRole, a, permissionDetails) - sidebarSortOrder(activeRole, b, permissionDetails);
    });
  }, [activeRole, baseSidebarResources, permissionDetails, sidebarOrderPreview]);

  useEffect(() => {
    setDraggingResourceKey(null);
    setDragOverResourceKey(null);
    setSidebarOrderPreview(null);
  }, [activeRole]);

  useEffect(() => {
    if (!sidebarOrderPreview || draggingResourceKey) return;
    const actualOrder = baseSidebarResources.map((resource) => resource.resource_key);
    if (sameOrder(actualOrder, sidebarOrderPreview)) {
      setSidebarOrderPreview(null);
    }
  }, [baseSidebarResources, draggingResourceKey, sidebarOrderPreview]);

  useLayoutEffect(() => {
    const previousRects = sidebarItemRects.current;
    if (previousRects.size === 0) return;

    sidebarItemRefs.current.forEach((node, resourceKey) => {
      const previous = previousRects.get(resourceKey);
      if (!previous) return;

      const next = node.getBoundingClientRect();
      const deltaX = previous.left - next.left;
      const deltaY = previous.top - next.top;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

      node.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: 180,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        },
      );
    });

    sidebarItemRects.current = new Map();
  }, [sidebarResources]);

  const groupedResources = useMemo(() => {
    const employeeOrgResources: PermissionListItem[] = [
      ...resources
        .filter((resource) => resource.resource_group === "employee_org")
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((resource) => ({ ...resource, displayGroup: "employee_org" as const })),
    ];
    const orderedResources: PermissionListItem[] = [
      ...employeeOrgResources,
      ...sidebarResources.map((resource) => ({ ...resource, displayGroup: "sidebar" as const })),
    ];
    const groups = new Map<string, typeof orderedResources>();
    for (const resource of orderedResources) {
      const group = resource.displayGroup === "employee_org" ? "员工与组织架构" : "侧边栏";
      groups.set(group, [...(groups.get(group) || []), resource]);
    }
    return Array.from(groups.entries());
  }, [resources, sidebarResources]);

  const setAccess = async (resourceKey: string, accessLevel: PermissionAccess) => {
    if (!canWrite || !activeRole || saveConfig.isPending) return;
    try {
      await saveConfig.mutateAsync({
        roleKey: activeRole,
        permissions: [{ resourceKey, accessLevel }],
      });
      toast.success("权限配置已保存");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const captureSidebarItemRects = () => {
    const next = new Map<string, DOMRect>();
    sidebarItemRefs.current.forEach((node, resourceKey) => {
      next.set(resourceKey, node.getBoundingClientRect());
    });
    sidebarItemRects.current = next;
  };

  const setSidebarItemRef = (resourceKey: string, node: HTMLDivElement | null) => {
    if (node) {
      sidebarItemRefs.current.set(resourceKey, node);
    } else {
      sidebarItemRefs.current.delete(resourceKey);
    }
  };

  const saveSidebarOrder = async (orderedItems: PermissionResource[]): Promise<boolean> => {
    if (!canWrite || !activeRole || saveConfig.isPending) return false;
    const permissions = orderedItems.map((resource, index) => ({
      resourceKey: resource.resource_key,
      sidebarOrder: (index + 1) * 10,
    }));
    try {
      await saveConfig.mutateAsync({ roleKey: activeRole, permissions });
      if (user?.role === activeRole) {
        setSidebarOrder({
          ...sidebarOrder,
          ...Object.fromEntries(permissions.map((item) => [item.resourceKey, item.sidebarOrder])),
        });
      }
      toast.success("侧边栏排序已保存");
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  };

  const moveSidebarPreview = (targetResourceKey: string) => {
    if (!draggingResourceKey || draggingResourceKey === targetResourceKey) return;
    const current = sidebarResources.map((resource) => resource.resource_key);
    const next = moveResourceKey(current, draggingResourceKey, targetResourceKey);
    if (!next || sameOrder(next, current)) return;

    captureSidebarItemRects();
    setDragOverResourceKey(targetResourceKey);
    setSidebarOrderPreview(next);
  };

  const commitSidebarOrder = (targetResourceKey: string) => {
    if (!draggingResourceKey) return;
    didDropRef.current = true;

    let orderedKeys = sidebarOrderPreview || sidebarResources.map((resource) => resource.resource_key);
    if (!sidebarOrderPreview && targetResourceKey !== draggingResourceKey) {
      const movedKeys = moveResourceKey(orderedKeys, draggingResourceKey, targetResourceKey);
      if (movedKeys) {
        captureSidebarItemRects();
        setSidebarOrderPreview(movedKeys);
        orderedKeys = movedKeys;
      }
    }

    const resourceMap = new Map(baseSidebarResources.map((resource) => [resource.resource_key, resource]));
    const orderedItems = orderedKeys.map((resourceKey) => resourceMap.get(resourceKey)).filter(Boolean) as PermissionResource[];
    const changed = !sameOrder(orderedKeys, baseSidebarResources.map((resource) => resource.resource_key));

    setDraggingResourceKey(null);
    setDragOverResourceKey(null);

    if (!changed) {
      setSidebarOrderPreview(null);
      return;
    }

    void saveSidebarOrder(orderedItems).then((saved) => {
      if (!saved) {
        captureSidebarItemRects();
        setSidebarOrderPreview(null);
      }
    });
  };

  const cancelSidebarDrag = () => {
    if (!didDropRef.current) {
      captureSidebarItemRects();
      setSidebarOrderPreview(null);
    }
    didDropRef.current = false;
    setDraggingResourceKey(null);
    setDragOverResourceKey(null);
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
                  const isSidebarResource = resource.displayGroup === "sidebar";
                  const canDrag = canWrite && isSidebarResource && !saveConfig.isPending;
                  return (
                    <div
                      key={`${resource.displayGroup}:${resource.resource_key}`}
                      ref={(node) => {
                        if (isSidebarResource) setSidebarItemRef(resource.resource_key, node);
                      }}
                      draggable={canDrag}
                      onDragStart={(event) => {
                        if (!canDrag) return;
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", resource.resource_key);
                        didDropRef.current = false;
                        setDraggingResourceKey(resource.resource_key);
                        setDragOverResourceKey(null);
                        setSidebarOrderPreview(sidebarResources.map((item) => item.resource_key));
                      }}
                      onDragOver={(event) => {
                        if (!canDrag || !draggingResourceKey) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        moveSidebarPreview(resource.resource_key);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (canDrag) commitSidebarOrder(resource.resource_key);
                      }}
                      onDragEnd={cancelSidebarDrag}
                      aria-grabbed={draggingResourceKey === resource.resource_key}
                      className={cn(
                        "grid grid-cols-[32px_1fr_120px_140px] items-center gap-3 rounded-md border border-border px-3 py-2 transition-[background-color,border-color,box-shadow,opacity] duration-150 ease-out max-[720px]:grid-cols-1 motion-reduce:transition-none",
                        canDrag && "cursor-grab",
                        dragOverResourceKey === resource.resource_key &&
                          draggingResourceKey !== resource.resource_key &&
                          "border-primary/40 bg-row-selected shadow-sm",
                        draggingResourceKey === resource.resource_key &&
                          "border-primary bg-primary/5 opacity-70 shadow-float",
                      )}
                    >
                      <div className="flex items-center justify-center text-muted-foreground">
                        {isSidebarResource ? (
                          <GripVertical className={cn("size-4", !canDrag && "opacity-40")} aria-hidden="true" />
                        ) : (
                          <span className="text-xs">-</span>
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{resource.displayName || resource.resource_name}</div>
                        <div className="text-xs text-muted-foreground">{resource.resource_key}</div>
                      </div>
                      <Badge variant="outline" className={cn("w-fit rounded-pill", accessTone[value])}>
                        {accessText[value]}
                      </Badge>
                      <Select
                        value={value}
                        disabled={!canWrite || saveConfig.isPending}
                        onValueChange={(next) => setAccess(resource.resource_key, next as PermissionAccess)}
                      >
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

function sidebarSortOrder(
  roleKey: string,
  resource: PermissionResource,
  permissionDetails: Map<string, { accessLevel: PermissionAccess; sidebarOrder: number }>,
): number {
  return permissionDetails.get(`${roleKey}:${resource.resource_key}`)?.sidebarOrder || resource.sort_order;
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function moveResourceKey(keys: string[], sourceKey: string, targetKey: string): string[] | null {
  const fromIndex = keys.indexOf(sourceKey);
  const toIndex = keys.indexOf(targetKey);
  if (fromIndex < 0 || toIndex < 0) return null;

  const next = [...keys];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

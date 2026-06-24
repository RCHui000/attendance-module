import { useMemo, useRef, useState, type CSSProperties } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermissionConfig, useSavePermissionConfig } from "@/hooks/useEmployees";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import type { PermissionAccess } from "@/types/auth";
import type { PermissionResource, PermissionRole } from "@/types/employee";
import { toast } from "sonner";

type PermissionListItem = PermissionResource & {
  displayGroup: "sidebar" | "employee_org";
  displayName?: string;
};

type SidebarDragMetrics = {
  activeKey: string;
  activeCenterY: number;
  centersByKey: Map<string, number>;
  initialKeys: string[];
  lastInsertIndex: number;
};

const DRAG_REORDER_HYSTERESIS_PX = 8;

interface PermissionConfigPanelProps {
  canWrite: boolean;
}

interface PermissionResourceRowProps {
  canDrag: boolean;
  canWrite: boolean;
  dragHandleAttributes?: DraggableAttributes;
  dragHandleListeners?: DraggableSyntheticListeners;
  isDragging?: boolean;
  isSidebarResource: boolean;
  resource: PermissionListItem;
  savePending: boolean;
  setAccess: (resourceKey: string, accessLevel: PermissionAccess) => void;
  style?: CSSProperties;
  value: PermissionAccess;
}

interface SortablePermissionResourceRowProps {
  canSort: boolean;
  canWrite: boolean;
  isDragging?: boolean;
  resource: PermissionListItem;
  savePending: boolean;
  setAccess: (resourceKey: string, accessLevel: PermissionAccess) => void;
  setSidebarItemNode: (resourceKey: string, node: HTMLDivElement | null) => void;
  value: PermissionAccess;
}

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

export function PermissionConfigPanel({ canWrite }: PermissionConfigPanelProps) {
  const { data, isLoading, isError } = usePermissionConfig();
  const saveConfig = useSavePermissionConfig();
  const { user, sidebarOrder, setSidebarOrder } = useAuthStore();
  const roles = useMemo<PermissionRole[]>(() => data?.roles || [], [data?.roles]);
  const resources = useMemo<PermissionResource[]>(() => data?.resources || [], [data?.resources]);
  const [selectedRole, setSelectedRole] = useState("");
  const [draggingResourceKey, setDraggingResourceKey] = useState<string | null>(null);
  const [draftSidebarOrder, setDraftSidebarOrder] = useState<string[] | null>(null);
  const draftSidebarOrderRef = useRef<string[] | null>(null);
  const dragStartOrderRef = useRef<string[] | null>(null);
  const sidebarDragMetricsRef = useRef<SidebarDragMetrics | null>(null);
  const pendingDragCenterYRef = useRef<number | null>(null);
  const dragMoveFrameRef = useRef<number | null>(null);
  const sidebarItemNodesRef = useRef(new Map<string, HTMLDivElement>());
  const activeRole = selectedRole || roles[0]?.role_key || "";
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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

  const baseSidebarKeys = useMemo(
    () => baseSidebarResources.map((resource) => resource.resource_key),
    [baseSidebarResources],
  );

  const sidebarResources = useMemo(() => {
    if (!draftSidebarOrder) return baseSidebarResources;

    const order = new Map(draftSidebarOrder.map((resourceKey, index) => [resourceKey, index]));
    return [...baseSidebarResources].sort((a, b) => {
      const aOrder = order.get(a.resource_key) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = order.get(b.resource_key) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return sidebarSortOrder(activeRole, a, permissionDetails) - sidebarSortOrder(activeRole, b, permissionDetails);
    });
  }, [activeRole, baseSidebarResources, draftSidebarOrder, permissionDetails]);

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

  const applyDraftSidebarOrder = (orderedKeys: string[] | null) => {
    draftSidebarOrderRef.current = orderedKeys;
    setDraftSidebarOrder(orderedKeys);
  };

  const setSidebarItemNode = (resourceKey: string, node: HTMLDivElement | null) => {
    if (node) {
      sidebarItemNodesRef.current.set(resourceKey, node);
    } else {
      sidebarItemNodesRef.current.delete(resourceKey);
    }
  };

  const captureSidebarDragMetrics = (activeKey: string): SidebarDragMetrics | null => {
    const centersByKey = new Map<string, number>();
    for (const resourceKey of baseSidebarKeys) {
      const rect = sidebarItemNodesRef.current.get(resourceKey)?.getBoundingClientRect();
      if (!rect) continue;
      centersByKey.set(resourceKey, rect.top + rect.height / 2);
    }

    const activeCenterY = centersByKey.get(activeKey);
    if (typeof activeCenterY !== "number") return null;

    return {
      activeKey,
      activeCenterY,
      centersByKey,
      initialKeys: baseSidebarKeys,
      lastInsertIndex: baseSidebarKeys.indexOf(activeKey),
    };
  };

  const orderSidebarKeysForDragPosition = (metrics: SidebarDragMetrics, activeCenterY: number) => {
    const otherKeys = metrics.initialKeys.filter((resourceKey) => resourceKey !== metrics.activeKey);
    let insertIndex = metrics.lastInsertIndex;

    while (insertIndex > 0) {
      const previousKey = otherKeys[insertIndex - 1];
      const previousCenter = metrics.centersByKey.get(previousKey);
      if (typeof previousCenter !== "number" || activeCenterY >= previousCenter - DRAG_REORDER_HYSTERESIS_PX) break;
      insertIndex -= 1;
    }

    while (insertIndex < otherKeys.length) {
      const nextKey = otherKeys[insertIndex];
      const nextCenter = metrics.centersByKey.get(nextKey);
      if (typeof nextCenter !== "number" || activeCenterY <= nextCenter + DRAG_REORDER_HYSTERESIS_PX) break;
      insertIndex += 1;
    }

    metrics.lastInsertIndex = insertIndex;
    const next = [...otherKeys];
    next.splice(insertIndex, 0, metrics.activeKey);
    return next;
  };

  const flushPendingDragMove = () => {
    dragMoveFrameRef.current = null;
    const metrics = sidebarDragMetricsRef.current;
    const activeCenterY = pendingDragCenterYRef.current;
    pendingDragCenterYRef.current = null;
    if (!metrics || activeCenterY === null) return;

    const orderedKeys = orderSidebarKeysForDragPosition(metrics, activeCenterY);
    if (!sameOrder(orderedKeys, draftSidebarOrderRef.current || baseSidebarKeys)) {
      applyDraftSidebarOrder(orderedKeys);
    }
  };

  const flushPendingDragMoveNow = () => {
    if (dragMoveFrameRef.current !== null) {
      cancelAnimationFrame(dragMoveFrameRef.current);
      dragMoveFrameRef.current = null;
    }
    flushPendingDragMove();
  };

  const cancelPendingDragMoveFrame = () => {
    if (dragMoveFrameRef.current !== null) {
      cancelAnimationFrame(dragMoveFrameRef.current);
      dragMoveFrameRef.current = null;
    }
    pendingDragCenterYRef.current = null;
  };

  const handleSidebarDragStart = (event: DragStartEvent) => {
    if (!canWrite || saveConfig.isPending) return;
    const resourceKey = String(event.active.id);
    dragStartOrderRef.current = baseSidebarKeys;
    sidebarDragMetricsRef.current = captureSidebarDragMetrics(resourceKey);
    setDraggingResourceKey(resourceKey);
    applyDraftSidebarOrder(baseSidebarKeys);
  };

  const handleSidebarDragMove = (event: DragMoveEvent) => {
    if (!canWrite || saveConfig.isPending) return;
    const metrics = sidebarDragMetricsRef.current;
    if (!metrics || String(event.active.id) !== metrics.activeKey) return;

    pendingDragCenterYRef.current = metrics.activeCenterY + event.delta.y;
    if (dragMoveFrameRef.current === null) {
      dragMoveFrameRef.current = requestAnimationFrame(flushPendingDragMove);
    }
  };

  const handleSidebarDragOver = (event: DragOverEvent) => {
    if (!canWrite || saveConfig.isPending || sidebarDragMetricsRef.current) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const orderedKeys = draftSidebarOrderRef.current || baseSidebarKeys;
    const oldIndex = orderedKeys.indexOf(String(active.id));
    const newIndex = orderedKeys.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
    applyDraftSidebarOrder(arrayMove(orderedKeys, oldIndex, newIndex));
  };

  const finishSidebarDrag = (event: DragEndEvent) => {
    flushPendingDragMoveNow();
    const orderedKeys = draftSidebarOrderRef.current || draftSidebarOrder || baseSidebarKeys;
    const originalKeys = dragStartOrderRef.current || baseSidebarKeys;
    setDraggingResourceKey(null);
    dragStartOrderRef.current = null;
    sidebarDragMetricsRef.current = null;
    cancelPendingDragMoveFrame();

    if (!event.over || !canWrite || saveConfig.isPending || sameOrder(orderedKeys, originalKeys)) {
      applyDraftSidebarOrder(null);
      return;
    }

    const resourceMap = new Map(baseSidebarResources.map((resource) => [resource.resource_key, resource]));
    const orderedItems = orderedKeys.map((resourceKey) => resourceMap.get(resourceKey)).filter(Boolean) as PermissionResource[];

    void saveSidebarOrder(orderedItems).then((saved) => {
      if (!saved) {
        applyDraftSidebarOrder(null);
      }
    });
  };

  const cancelSidebarDrag = (_event?: DragCancelEvent) => {
    setDraggingResourceKey(null);
    applyDraftSidebarOrder(null);
    dragStartOrderRef.current = null;
    sidebarDragMetricsRef.current = null;
    cancelPendingDragMoveFrame();
  };

  if (isLoading) return <div className="py-10 text-sm text-muted-foreground">加载权限配置中...</div>;
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
                "mb-1 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:transition-none",
                activeRole === role.role_key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
              onClick={() => {
                cancelSidebarDrag();
                setSelectedRole(role.role_key);
              }}
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
              {items[0]?.displayGroup === "sidebar" ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis]}
                  onDragStart={handleSidebarDragStart}
                  onDragMove={handleSidebarDragMove}
                  onDragOver={handleSidebarDragOver}
                  onDragEnd={finishSidebarDrag}
                  onDragCancel={cancelSidebarDrag}
                >
                  <SortableContext
                    items={items.map((resource) => resource.resource_key)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="grid gap-2" data-testid="permission-sidebar-sortable-list">
                      {items.map((resource) => (
                        <SortablePermissionResourceRow
                          key={`${resource.displayGroup}:${resource.resource_key}`}
                          canSort={canWrite && !saveConfig.isPending}
                          canWrite={canWrite}
                          isDragging={draggingResourceKey === resource.resource_key}
                          resource={resource}
                          savePending={saveConfig.isPending}
                          setAccess={setAccess}
                          setSidebarItemNode={setSidebarItemNode}
                          value={matrix.get(`${activeRole}:${resource.resource_key}`) || "none"}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <div className="grid gap-2">
                  {items.map((resource) => (
                    <PermissionResourceRow
                      key={`${resource.displayGroup}:${resource.resource_key}`}
                      canDrag={false}
                      canWrite={canWrite}
                      isSidebarResource={false}
                      resource={resource}
                      savePending={saveConfig.isPending}
                      setAccess={setAccess}
                      value={matrix.get(`${activeRole}:${resource.resource_key}`) || "none"}
                    />
                  ))}
                </div>
              )}
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

function SortablePermissionResourceRow({
  canSort,
  canWrite,
  isDragging,
  resource,
  savePending,
  setAccess,
  setSidebarItemNode,
  value,
}: SortablePermissionResourceRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: sortableDragging,
  } = useSortable({
    id: resource.resource_key,
    disabled: !canSort,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const setCombinedNodeRef = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    setSidebarItemNode(resource.resource_key, node);
  };

  return (
    <PermissionResourceRow
      canDrag={canSort}
      canWrite={canWrite}
      dragHandleAttributes={attributes}
      dragHandleListeners={listeners}
      isDragging={isDragging || sortableDragging}
      isSidebarResource
      resource={resource}
      savePending={savePending}
      setAccess={setAccess}
      style={style}
      value={value}
      refCallback={setCombinedNodeRef}
    />
  );
}

function PermissionResourceRow({
  canDrag,
  canWrite,
  dragHandleAttributes,
  dragHandleListeners,
  isDragging,
  isSidebarResource,
  resource,
  savePending,
  setAccess,
  style,
  value,
  refCallback,
}: PermissionResourceRowProps & { refCallback?: (node: HTMLDivElement | null) => void }) {
  return (
    <div
      ref={refCallback}
      style={style}
      data-testid={isSidebarResource ? `permission-sidebar-sortable-item-${resource.resource_key}` : undefined}
      className={cn(
        "grid grid-cols-[32px_1fr_120px_140px] items-center gap-3 rounded-md border border-border bg-white px-3 py-2 transition-[background-color,border-color,box-shadow,opacity,transform] duration-150 ease-out max-[720px]:grid-cols-1 motion-reduce:transition-none",
        isSidebarResource && canDrag && "cursor-default",
        isDragging && "relative z-10 border-primary bg-primary/5 opacity-80 shadow-float",
      )}
    >
      <div className="flex items-center justify-center text-muted-foreground">
        {isSidebarResource ? (
          <button
            type="button"
            disabled={!canDrag}
            aria-label={`拖拽排序 ${resource.displayName || resource.resource_name}`}
            data-testid={`permission-sidebar-drag-handle-${resource.resource_key}`}
            className={cn(
              "flex size-7 touch-none items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,box-shadow] duration-150 ease-out hover:bg-row-hover hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:transition-none",
              canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed opacity-40",
            )}
            {...dragHandleAttributes}
            {...dragHandleListeners}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
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
        disabled={!canWrite || savePending}
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

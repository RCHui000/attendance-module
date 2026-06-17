import { useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppCenterItems, useDeleteAppCenterItem, useSaveAppCenterItem } from "@/hooks/useAppCenter";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import type { AppCenterItem, SaveAppCenterItemInput } from "@/types/appCenter";
import {
  Boxes,
  BriefcaseBusiness,
  Check,
  ExternalLink,
  Pencil,
  Plus,
  RadioTower,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

const iconOptions = [
  { key: "app", label: "应用", Icon: Boxes },
  { key: "radio", label: "聚合", Icon: RadioTower },
  { key: "business", label: "业务", Icon: BriefcaseBusiness },
] as const;

const emptyDraft: SaveAppCenterItemInput = {
  name: "",
  description: "",
  url: "",
  icon_key: "app",
  tags: [],
  is_internal: false,
  is_active: true,
  sort_order: 100,
};

function iconFor(key: string) {
  return iconOptions.find((option) => option.key === key)?.Icon || Boxes;
}

function visibleTags(app: AppCenterItem) {
  const tags = app.tags || [];
  if (app.is_internal && !tags.includes("内网")) return ["内网", ...tags];
  return tags;
}

function AppCard({ app }: { app: AppCenterItem }) {
  const Icon = iconFor(app.icon_key);
  const tags = visibleTags(app);

  return (
    <a
      href={app.url}
      target="_blank"
      rel="noreferrer"
      className="group flex min-h-[148px] flex-col justify-between rounded-lg bg-card p-4 text-card-foreground shadow-app ring-1 ring-foreground/10 transition hover:-translate-y-0.5 hover:ring-primary/35 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
      aria-label={`打开${app.name}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <h3 className="truncate text-sm font-semibold">{app.name}</h3>
            <ExternalLink className="mt-0.5 size-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
          </div>
          {app.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {app.description}
            </p>
          )}
        </div>
      </div>
      {tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="h-6 rounded-md px-2 text-[11px]">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </a>
  );
}

function AppFormDialog({
  open,
  draft,
  saving,
  onOpenChange,
  onDraftChange,
  onSave,
}: {
  open: boolean;
  draft: SaveAppCenterItemInput;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: SaveAppCenterItemInput) => void;
  onSave: () => void;
}) {
  const tagText = useMemo(() => (draft.tags || []).join("，"), [draft.tags]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{draft.id ? "编辑应用" : "添加应用"}</DialogTitle>
          <DialogDescription>维护应用中心入口，用户侧卡片不会展示具体内网地址。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="app-name">应用名称</Label>
            <Input
              id="app-name"
              value={draft.name}
              onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
              placeholder="例如：招标信息聚合"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="app-url">访问地址</Label>
            <Input
              id="app-url"
              value={draft.url}
              onChange={(event) => onDraftChange({ ...draft, url: event.target.value })}
              placeholder="https:// 或 http://"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="app-description">卡片描述</Label>
            <Textarea
              id="app-description"
              value={draft.description || ""}
              onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
              placeholder="一句话说明这个应用能做什么"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_128px]">
            <div className="grid gap-1.5">
              <Label htmlFor="app-tags">标签</Label>
              <Input
                id="app-tags"
                value={tagText}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    tags: event.target.value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
                  })
                }
                placeholder="内网，招标"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="app-sort">排序</Label>
              <Input
                id="app-sort"
                type="number"
                value={draft.sort_order ?? 100}
                onChange={(event) => onDraftChange({ ...draft, sort_order: Number(event.target.value || 0) })}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>图标</Label>
            <div className="grid grid-cols-3 gap-2">
              {iconOptions.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    "flex h-10 items-center justify-center gap-2 rounded-md border text-sm transition hover:bg-muted",
                    draft.icon_key === key && "border-primary bg-primary/5 text-primary",
                  )}
                  onClick={() => onDraftChange({ ...draft, icon_key: key })}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition hover:bg-muted",
                draft.is_internal && "border-primary bg-primary/5 text-primary",
              )}
              onClick={() => onDraftChange({ ...draft, is_internal: !draft.is_internal })}
            >
              {draft.is_internal && <Check className="size-4" />}
              内网应用
            </button>
            <button
              type="button"
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition hover:bg-muted",
                draft.is_active !== false && "border-primary bg-primary/5 text-primary",
              )}
              onClick={() => onDraftChange({ ...draft, is_active: draft.is_active === false })}
            >
              {draft.is_active !== false && <Check className="size-4" />}
              启用
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AppsPage() {
  const { canAccess } = useAuthStore();
  const canManage = canAccess("apps", "write");
  const { data: apps = [], isLoading, isError } = useAppCenterItems();
  const saveApp = useSaveAppCenterItem();
  const deleteApp = useDeleteAppCenterItem();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<SaveAppCenterItemInput>(emptyDraft);
  const [deleteTarget, setDeleteTarget] = useState<AppCenterItem | null>(null);

  const activeApps = canManage ? apps.filter((app) => app.is_active) : apps;

  const openCreate = () => {
    setDraft({ ...emptyDraft });
    setDialogOpen(true);
  };

  const openEdit = (app: AppCenterItem) => {
    setDraft({
      id: app.id,
      app_key: app.app_key,
      name: app.name,
      description: app.description,
      url: app.url,
      icon_key: app.icon_key,
      tags: app.tags,
      is_internal: app.is_internal,
      is_active: app.is_active,
      sort_order: app.sort_order,
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    saveApp.mutate(draft, {
      onSuccess: () => {
        toast.success("应用已保存");
        setDialogOpen(false);
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : "应用保存失败"),
    });
  };

  const handleToggle = (app: AppCenterItem) => {
    saveApp.mutate(
      { ...app, is_active: !app.is_active },
      {
        onSuccess: () => toast.success(app.is_active ? "应用已停用" : "应用已启用"),
        onError: (error) => toast.error(error instanceof Error ? error.message : "状态更新失败"),
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteApp.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("应用已删除");
        setDeleteTarget(null);
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : "应用删除失败"),
    });
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">应用中心</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            统一进入公司内部工具和业务应用。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{activeApps.length} 个应用</Badge>
          {canManage && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" />
              添加应用
            </Button>
          )}
        </div>
      </div>

      {isLoading && <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>}
      {isError && <div className="py-10 text-center text-sm text-destructive">应用中心加载失败</div>}
      {!isLoading && !isError && activeApps.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          暂无可用应用
        </div>
      )}
      {activeApps.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {activeApps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      )}

      {canManage && (
        <div className="space-y-3 rounded-lg border border-border bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">应用维护</h3>
              <p className="mt-1 text-xs text-muted-foreground">仅管理员可见，用于维护入口地址、排序和启停状态。</p>
            </div>
          </div>
          <div className="divide-y rounded-lg border border-border">
            {apps.map((app) => (
              <div key={app.id} className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_120px_144px] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{app.name}</span>
                    {!app.is_active && <Badge variant="outline">停用</Badge>}
                    {visibleTags(app).slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="secondary">{tag}</Badge>
                    ))}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{app.url}</div>
                </div>
                <div className="text-xs text-muted-foreground">排序 {app.sort_order}</div>
                <div className="flex justify-start gap-1 md:justify-end">
                  <Button variant="ghost" size="icon-sm" onClick={() => openEdit(app)} aria-label="编辑应用">
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => handleToggle(app)} aria-label="启停应用">
                    <Check className={cn("size-4", !app.is_active && "opacity-35")} />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(app)} aria-label="删除应用">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AppFormDialog
        open={dialogOpen}
        draft={draft}
        saving={saveApp.isPending}
        onOpenChange={setDialogOpen}
        onDraftChange={setDraft}
        onSave={handleSave}
      />

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除应用？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后应用中心不再显示该入口。
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

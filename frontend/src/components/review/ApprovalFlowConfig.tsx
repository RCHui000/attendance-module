import { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  GripVertical,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApprovalTemplates, useSaveApprovalTemplate } from "@/hooks/useApprovals";
import { cn } from "@/lib/utils";
import type { ApprovalTemplate, ApprovalTemplateNode } from "@/types/approval";

const NONE_VALUE = "__none__";
const SUBMITTER_ROLES = new Set(["submitter"]);
const NORMAL_TEMPLATE_KEYS = new Set([
  "contract_approval_pm_v1",
  "contract_approval_cc_v1",
  "contract_approval_pmcc_v1",
]);
const SPECIAL_TEMPLATE_KEY = "timesheet_special_department_owner_v1";

const approvalPolicyOptions = [
  { value: "single", label: "单人通过" },
  { value: "all", label: "全部通过" },
  { value: "any", label: "任一通过" },
  { value: "auto_pass", label: "自动通过" },
];

const rejectPolicyOptions = [
  { value: "back_to_creator", label: "退回提交人" },
  { value: "back_to_previous", label: "退回上一步" },
  { value: "restart", label: "重新流转" },
];

const resolverOptions = [
  { value: "document_creator", label: "提交人" },
  { value: "project_role", label: "项目负责人配置" },
  { value: "org_manager", label: "组织负责人配置" },
  { value: "fixed_user", label: "固定人员" },
  { value: "expression_limited", label: "表达式限定" },
];

const roleOptions = [
  { value: "submitter", label: "提交人" },
  { value: "department_owner", label: "发起部门负责人" },
  { value: "cc_civil_project_owner", label: "QS土建负责人" },
  { value: "cc_mep_project_owner", label: "QS机电负责人" },
  { value: "cc_project_owner", label: "发起部门项目负责人" },
  { value: "cc_department_owner", label: "发起部门负责人" },
  { value: "cc_design_project_owner", label: "设计咨询负责人" },
  { value: "pm_cost_department_owner", label: "PM成本/设计负责人" },
  { value: "pm_design_project_owner", label: "PM设计负责人" },
  { value: "pm_project_owner", label: "PM项目负责人" },
  { value: "pm_department_owner", label: "PM部门负责人" },
];

const templateMeta: Record<string, { label: string; description: string; tone: string }> = {
  contract_approval_pm_v1: {
    label: "项目管理审批",
    description: "项目管理部内部项目块审批",
    tone: "border-sky-300 bg-sky-50/70 text-sky-950 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100",
  },
  contract_approval_cc_v1: {
    label: "QS/设计侧审批",
    description: "总工办侧项目块审批",
    tone: "border-emerald-300 bg-emerald-50/70 text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100",
  },
  contract_approval_pmcc_v1: {
    label: "协作审批",
    description: "总工办与项目管理部协作审批",
    tone: "border-amber-300 bg-amber-50/70 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100",
  },
  [SPECIAL_TEMPLATE_KEY]: {
    label: "请假/特殊项目确认",
    description: "特殊项目块单独走所属部门负责人确认",
    tone: "border-violet-300 bg-violet-50/70 text-violet-950 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-100",
  },
};

function labelFrom<T extends { value: string; label: string }>(options: T[], value?: string | null) {
  if (!value) return "未配置";
  return options.find((option) => option.value === value)?.label || value;
}

function templateDisplayName(template: ApprovalTemplate) {
  return templateMeta[template.template_key]?.label || template.name || template.template_key;
}

function templateDescription(template: ApprovalTemplate) {
  return templateMeta[template.template_key]?.description || template.template_key;
}

function isSubmitterNode(node: ApprovalTemplateNode) {
  return node.resolver_type === "document_creator" || SUBMITTER_ROLES.has(node.resolver_role || "");
}

function isSpecialTemplate(template: ApprovalTemplate | null) {
  return template?.template_key === SPECIAL_TEMPLATE_KEY;
}

function isSystemNode(template: ApprovalTemplate | null, node: ApprovalTemplateNode) {
  return isSubmitterNode(node) || (isSpecialTemplate(template) && node.node_key === "special_department_owner");
}

function normalizeNodes(nodes: ApprovalTemplateNode[]) {
  return [...nodes]
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    .map((node, index) => ({
      ...node,
      sort_order: (index + 1) * 10,
      node_type: node.node_type || "approval",
      approval_policy: node.approval_policy || "single",
      reject_policy: node.reject_policy || "back_to_creator",
      scope_strategy: isSubmitterNode(node) ? "submitter_virtual" : node.scope_strategy || "per_project",
      scope_source: isSubmitterNode(node) ? "document" : node.scope_source || "timesheet_projects",
      runtime_scope_type: isSubmitterNode(node) ? null : node.runtime_scope_type || "project",
      runtime_node_key_template: isSubmitterNode(node)
        ? "{node_key}"
        : node.runtime_node_key_template || "project_{scope_id}_{node_key}",
      missing_assignee_policy: isSubmitterNode(node)
        ? "required"
        : node.missing_assignee_policy || (node.node_key === "special_department_owner" ? "required" : "skip"),
    }));
}

function cloneTemplate(template: ApprovalTemplate): ApprovalTemplate {
  return {
    ...JSON.parse(JSON.stringify(template)),
    nodes: normalizeNodes(template.nodes || []),
  } as ApprovalTemplate;
}

function moveNode(nodes: ApprovalTemplateNode[], fromKey: string, toKey: string) {
  const ordered = normalizeNodes(nodes);
  const fromIndex = ordered.findIndex((node) => node.node_key === fromKey);
  const toIndex = ordered.findIndex((node) => node.node_key === toKey);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return ordered;
  const [item] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, item);
  return normalizeNodes(ordered);
}

function createApprovalNode(template: ApprovalTemplate, index: number): ApprovalTemplateNode {
  const nodeKey = `custom_approval_${Date.now()}`;
  return {
    id: -Date.now(),
    template_id: template.id,
    node_key: nodeKey,
    node_name: "新审批节点",
    node_type: "approval",
    resolver_type: "project_role",
    resolver_role: "pm_project_owner",
    approval_policy: "single",
    reject_policy: "back_to_creator",
    allow_delegate: false,
    allow_skip: false,
    sort_order: (index + 1) * 10,
    scope_strategy: "per_project",
    scope_source: "timesheet_projects",
    runtime_scope_type: "project",
    runtime_node_key_template: "project_{scope_id}_{node_key}",
    missing_assignee_policy: "skip",
  };
}

function validateTemplate(template: ApprovalTemplate | null) {
  if (!template) return ["请选择一个审批模板"];
  const nodes = normalizeNodes(template.nodes || []);
  const errors: string[] = [];
  const keys = new Set<string>();

  nodes.forEach((node) => {
    if (!node.node_key.trim()) errors.push("存在缺少节点 key 的节点");
    if (!node.node_name.trim()) errors.push(`${node.node_key || "未命名节点"} 缺少节点名称`);
    if (keys.has(node.node_key)) errors.push(`节点 key 重复：${node.node_key}`);
    keys.add(node.node_key);
    if (!node.resolver_type) errors.push(`${node.node_name} 缺少审批人来源`);
    if (!isSubmitterNode(node) && ["project_role", "org_manager"].includes(node.resolver_type) && !node.resolver_role) {
      errors.push(`${node.node_name} 缺少负责人角色`);
    }
  });

  if (isSpecialTemplate(template)) {
    if (nodes.length !== 1 || nodes[0]?.node_key !== "special_department_owner") {
      errors.push("请假/特殊项目模板只允许所属部门负责人确认节点");
    }
  } else {
    if (!nodes.some(isSubmitterNode)) errors.push("普通模板必须保留提交人节点");
    if (!nodes.some((node) => !isSubmitterNode(node))) errors.push("普通模板至少需要一个审批节点");
    if (nodes.some((node) => node.node_key === "special_department_owner")) {
      errors.push("普通模板不能包含特殊项目确认节点");
    }
  }

  return Array.from(new Set(errors));
}

function FlowNodeCard({
  template,
  node,
  index,
  selected,
  canWrite,
  onSelect,
  onDragStart,
  onDrop,
  onDelete,
}: {
  template: ApprovalTemplate;
  node: ApprovalTemplateNode;
  index: number;
  selected: boolean;
  canWrite: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDrop: () => void;
  onDelete: () => void;
}) {
  const systemNode = isSystemNode(template, node);
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        draggable={canWrite && !systemNode}
        onDragStart={onDragStart}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onClick={onSelect}
        className={cn(
          "group min-h-[154px] w-[240px] rounded-xl border bg-card p-4 text-left shadow-sm transition-[border-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:transition-none",
          selected ? "border-foreground shadow-md" : "border-border",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-muted-foreground">节点 {index + 1}</div>
            <div className="mt-1 line-clamp-2 text-base font-semibold text-foreground">{node.node_name}</div>
          </div>
          <div className="flex items-center gap-1">
            {systemNode ? (
              <Lock className="size-4 text-muted-foreground" />
            ) : (
              <GripVertical className="size-4 text-muted-foreground opacity-60 group-hover:opacity-100" />
            )}
          </div>
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">审批人</span>
            <span className="truncate font-medium">{labelFrom(roleOptions, node.resolver_role)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">来源</span>
            <span className="truncate">{labelFrom(resolverOptions, node.resolver_type)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">策略</span>
            <span>{labelFrom(approvalPolicyOptions, node.approval_policy)}</span>
          </div>
        </div>
        {canWrite && !systemNode && (
          <div className="mt-3 flex justify-end">
            <span
              role="button"
              tabIndex={0}
              className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onDelete();
                }
              }}
            >
              <Trash2 className="size-3.5" />
            </span>
          </div>
        )}
      </button>
    </div>
  );
}

function NodeInspector({
  template,
  node,
  canWrite,
  onChange,
}: {
  template: ApprovalTemplate | null;
  node: ApprovalTemplateNode | null;
  canWrite: boolean;
  onChange: (patch: Partial<ApprovalTemplateNode>) => void;
}) {
  if (!template || !node) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        选择一个节点后可以配置审批人来源、角色和通过策略。
      </div>
    );
  }

  const locked = !canWrite || isSystemNode(template, node);
  const submitter = isSubmitterNode(node);

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <div className="text-sm font-semibold text-foreground">节点属性</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {locked ? "系统节点保留关键规则，只允许查看。" : "修改后保存模板才会生效。"}
        </div>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">节点名称</span>
        <Input
          value={node.node_name}
          disabled={locked}
          onChange={(event) => onChange({ node_name: event.target.value })}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">审批人来源</span>
        <Select
          value={node.resolver_type}
          disabled={locked || submitter}
          onValueChange={(value) =>
            onChange({
              resolver_type: value || "",
              resolver_role: value === "document_creator" ? "submitter" : node.resolver_role,
            })
          }
        >
          <SelectTrigger>
            <SelectValue>{labelFrom(resolverOptions, node.resolver_type)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {resolverOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">负责人角色</span>
        <Select
          value={node.resolver_role || NONE_VALUE}
          disabled={locked || submitter}
          onValueChange={(value) => onChange({ resolver_role: value === NONE_VALUE ? null : value })}
        >
          <SelectTrigger>
            <SelectValue>{labelFrom(roleOptions, node.resolver_role)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>未配置</SelectItem>
            {roleOptions
              .filter((option) => option.value !== "submitter")
              .map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">通过策略</span>
          <Select
            value={node.approval_policy}
            disabled={locked || submitter}
          onValueChange={(value) => onChange({ approval_policy: value || "single" })}
          >
            <SelectTrigger>
              <SelectValue>{labelFrom(approvalPolicyOptions, node.approval_policy)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {approvalPolicyOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">退回方式</span>
          <Select
            value={node.reject_policy}
            disabled={locked || submitter}
            onValueChange={(value) => onChange({ reject_policy: value || "back_to_creator" })}
          >
            <SelectTrigger>
              <SelectValue>{labelFrom(rejectPolicyOptions, node.reject_policy)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {rejectPolicyOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <details className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">高级信息</summary>
        <dl className="mt-3 space-y-2">
          <div className="flex justify-between gap-3">
            <dt>node_key</dt>
            <dd className="truncate font-mono">{node.node_key}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>resolver_type</dt>
            <dd className="truncate font-mono">{node.resolver_type}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>resolver_role</dt>
            <dd className="truncate font-mono">{node.resolver_role || "-"}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

export function ApprovalFlowConfig({ canWrite }: { canWrite: boolean }) {
  const { data: templates = [], isLoading, isError } = useApprovalTemplates();
  const saveTemplate = useSaveApprovalTemplate();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ApprovalTemplate | null>(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [dragNodeKey, setDragNodeKey] = useState<string | null>(null);

  const configurableTemplates = useMemo(
    () =>
      templates
        .filter((template) => NORMAL_TEMPLATE_KEYS.has(template.template_key) || template.template_key === SPECIAL_TEMPLATE_KEY)
        .sort((a, b) => {
          const order = ["contract_approval_pm_v1", "contract_approval_cc_v1", "contract_approval_pmcc_v1", SPECIAL_TEMPLATE_KEY];
          return order.indexOf(a.template_key) - order.indexOf(b.template_key);
        }),
    [templates],
  );

  const effectiveSelectedId = selectedId ?? configurableTemplates[0]?.id ?? null;
  const selectedTemplate = configurableTemplates.find((template) => template.id === effectiveSelectedId) || configurableTemplates[0] || null;
  const activeDraft = draft?.id === selectedTemplate?.id ? draft : selectedTemplate ? cloneTemplate(selectedTemplate) : null;
  const nodes = normalizeNodes(activeDraft?.nodes || []);
  const selectedNode = nodes.find((node) => node.node_key === selectedNodeKey) || nodes[0] || null;
  const validationErrors = validateTemplate(activeDraft);
  const hasErrors = validationErrors.length > 0;

  const updateDraft = (updater: (template: ApprovalTemplate) => ApprovalTemplate) => {
    if (!activeDraft) return;
    setDraft(updater(cloneTemplate(activeDraft)));
  };

  const updateNode = (nodeKey: string, patch: Partial<ApprovalTemplateNode>) => {
    updateDraft((template) => ({
      ...template,
      nodes: normalizeNodes(template.nodes.map((node) => (node.node_key === nodeKey ? { ...node, ...patch } : node))),
    }));
  };

  const deleteNode = (nodeKey: string) => {
    if (!activeDraft) return;
    const target = activeDraft.nodes.find((node) => node.node_key === nodeKey);
    if (!target || isSystemNode(activeDraft, target)) return;
    updateDraft((template) => ({
      ...template,
      nodes: normalizeNodes(template.nodes.filter((node) => node.node_key !== nodeKey)),
    }));
    setSelectedNodeKey(null);
  };

  const addNode = () => {
    if (!activeDraft || isSpecialTemplate(activeDraft)) return;
    const nextNode = createApprovalNode(activeDraft, activeDraft.nodes.length);
    updateDraft((template) => ({
      ...template,
      nodes: normalizeNodes([...template.nodes, nextNode]),
    }));
    setSelectedNodeKey(nextNode.node_key);
  };

  const handleSave = () => {
    if (!activeDraft || !canWrite || hasErrors) return;
    saveTemplate.mutate(
      { ...activeDraft, nodes: normalizeNodes(activeDraft.nodes) },
      {
        onSuccess: () => toast.success("审批模板已保存"),
        onError: (error) => toast.error(error instanceof Error ? error.message : "审批模板保存失败"),
      },
    );
  };

  if (isLoading) return <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>;
  if (isError) return <div className="py-10 text-center text-sm text-destructive">审批模板加载失败</div>;

  return (
    <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
      <aside className="rounded-xl border border-border bg-card p-2">
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">审批模板</div>
        <div className="space-y-1">
          {configurableTemplates.map((template) => {
            const active = activeDraft?.id === template.id;
            return (
              <button
                key={template.id}
                type="button"
                className={cn(
                  "w-full rounded-lg px-3 py-3 text-left transition-[background-color,color,box-shadow] duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
                  active && "bg-muted shadow-sm",
                )}
                onClick={() => {
                  const next = cloneTemplate(template);
                  setSelectedId(template.id);
                  setDraft(next);
                  setSelectedNodeKey(next.nodes[0]?.node_key || null);
                }}
              >
                <div className="font-semibold text-foreground">{templateDisplayName(template)}</div>
                <div className="mt-1 text-xs text-muted-foreground">{templateDescription(template)}</div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="min-w-0 space-y-4">
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-foreground">{activeDraft ? templateDisplayName(activeDraft) : "审批流配置"}</h3>
                {activeDraft && (
                  <span className={cn("rounded-full border px-2 py-0.5 text-xs", templateMeta[activeDraft.template_key]?.tone)}>
                    {activeDraft.document_type === "timesheet_project" ? "独立特殊模板" : "普通模板"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">拖拽节点调整顺序，系统会按顺序自动生成审批边。</p>
            </div>
            <div className="flex items-center gap-2">
              {!canWrite && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  <Lock className="size-3.5" />
                  只读
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!selectedTemplate) return;
                  const next = cloneTemplate(selectedTemplate);
                  setDraft(next);
                  setSelectedNodeKey(next.nodes[0]?.node_key || null);
                }}
                disabled={!activeDraft}
              >
                <RotateCcw className="mr-1 size-3.5" />
                还原
              </Button>
              <Button variant="outline" size="sm" onClick={addNode} disabled={!canWrite || !activeDraft || isSpecialTemplate(activeDraft)}>
                <Plus className="mr-1 size-3.5" />
                添加节点
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!canWrite || !activeDraft || hasErrors || saveTemplate.isPending}>
                <Save className="mr-1 size-3.5" />
                保存模板
              </Button>
            </div>
          </div>

          <div
            className={cn(
              "mt-4 rounded-lg border px-3 py-2 text-sm",
              hasErrors
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
            )}
          >
            {hasErrors ? (
              <div className="flex gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div>
                  <div className="font-medium">模板需要修正</div>
                  <ul className="mt-1 list-inside list-disc text-xs">
                    {validationErrors.slice(0, 4).map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Check className="size-4" />
                当前模板校验通过
              </div>
            )}
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-border bg-muted/20 p-5">
          <div className="flex min-w-max items-center gap-4">
            {nodes.map((node, index) => (
              <div key={node.node_key} className="flex items-center gap-4">
                <FlowNodeCard
                  template={activeDraft!}
                  node={node}
                  index={index}
                  selected={selectedNode?.node_key === node.node_key}
                  canWrite={canWrite}
                  onSelect={() => setSelectedNodeKey(node.node_key)}
                  onDragStart={() => setDragNodeKey(node.node_key)}
                  onDrop={() => {
                    if (!dragNodeKey || !activeDraft) return;
                    updateDraft((template) => ({
                      ...template,
                      nodes: moveNode(template.nodes, dragNodeKey, node.node_key),
                    }));
                    setDragNodeKey(null);
                  }}
                  onDelete={() => deleteNode(node.node_key)}
                />
                {index < nodes.length - 1 && <div className="h-px w-12 bg-border" />}
              </div>
            ))}
          </div>
        </section>
      </main>

      <aside>
        <NodeInspector
          template={activeDraft}
          node={selectedNode}
          canWrite={canWrite}
          onChange={(patch) => selectedNode && updateNode(selectedNode.node_key, patch)}
        />
      </aside>
    </div>
  );
}

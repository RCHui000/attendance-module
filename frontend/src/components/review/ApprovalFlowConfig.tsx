import { useMemo, useState } from "react";
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
import { toast } from "sonner";
import { Save } from "lucide-react";

const NONE_VALUE = "__none__";

const policyOptions = [
  { value: "single", label: "单人审批" },
  { value: "all", label: "全部通过" },
  { value: "any", label: "任一通过" },
  { value: "auto_pass", label: "自动通过" },
];

const resolverOptions = [
  { value: "document_creator", label: "提交人" },
  { value: "project_role", label: "项目负责人配置" },
  { value: "org_manager", label: "组织负责人配置" },
  { value: "fixed_user", label: "固定人员" },
  { value: "expression_limited", label: "表达式限定" },
];

const roleLabel: Record<string, string> = {
  submitter: "提交人",
  department_owner: "发起部门负责人",
  cc_civil_project_owner: "QS土建负责人",
  cc_mep_project_owner: "QS机电负责人",
  cc_project_owner: "发起部门项目负责人",
  cc_department_owner: "发起部门负责人",
  cc_design_project_owner: "设计咨询负责人",
  pm_cost_department_owner: "PM成本/设计负责人",
  pm_design_project_owner: "PM设计负责人",
  pm_project_owner: "PM项目负责人",
  pm_department_owner: "PM部门负责人",
};

const roleOptions = [
  "submitter",
  "department_owner",
  "cc_civil_project_owner",
  "cc_mep_project_owner",
  "cc_project_owner",
  "cc_department_owner",
  "cc_design_project_owner",
  "pm_cost_department_owner",
  "pm_design_project_owner",
  "pm_project_owner",
  "pm_department_owner",
];

const businessTypeLabel: Record<string, string> = {
  PM: "项目管理审批",
  CC: "QS/设计侧审批",
  PMCC: "总工办/项目管理部协作审批",
};

function resolverTypeLabel(value: string) {
  return resolverOptions.find((option) => option.value === value)?.label || value || "未配置";
}

function approvalPolicyLabel(value: string) {
  return policyOptions.find((option) => option.value === value)?.label || value || "未配置";
}

function roleDisplayLabel(value?: string | null) {
  if (!value) return "未配置";
  return roleLabel[value] || value;
}

function templateDisplayName(template: ApprovalTemplate) {
  return businessTypeLabel[template.business_type || ""] || template.name || template.business_type || "通用审批";
}

function orderedNodes(template: ApprovalTemplate | null) {
  return [...(template?.nodes || [])].sort((a, b) => a.sort_order - b.sort_order);
}

function cloneTemplate(template: ApprovalTemplate): ApprovalTemplate {
  return JSON.parse(JSON.stringify(template)) as ApprovalTemplate;
}

function FlowPreview({ template }: { template: ApprovalTemplate | null }) {
  const nodes = orderedNodes(template);
  if (!template || !nodes.length) {
    return <div className="py-10 text-center text-sm text-muted-foreground">暂无模板节点</div>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex min-w-max items-center gap-2">
        {nodes.map((node, index) => (
          <div key={node.id} className="flex items-center gap-2">
            <div
              className={cn(
                "w-[180px] rounded-lg border bg-card px-3 py-3 shadow-sm",
                template.business_type === "PM" && "border-sky-200",
                template.business_type === "CC" && "border-emerald-200",
                template.business_type === "PMCC" && "border-amber-200",
              )}
            >
              <div className="text-sm font-semibold">{node.node_name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {node.resolver_role ? roleDisplayLabel(node.resolver_role) : resolverTypeLabel(node.resolver_type)}
              </div>
              <div className="mt-2 truncate text-[11px] text-muted-foreground/70">{node.node_key}</div>
            </div>
            {index < nodes.length - 1 && <div className="text-lg text-muted-foreground">→</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function NodeEditor({
  node,
  canWrite,
  onChange,
}: {
  node: ApprovalTemplateNode;
  canWrite: boolean;
  onChange: (patch: Partial<ApprovalTemplateNode>) => void;
}) {
  return (
    <div className="grid grid-cols-[72px_1.2fr_1fr_1fr_112px] items-start gap-2 rounded-md border border-border bg-card p-2">
      <Input
        className="h-8 text-sm"
        type="number"
        value={node.sort_order}
        disabled={!canWrite}
        onChange={(event) => onChange({ sort_order: Number(event.target.value || 0) })}
      />
      <Input
        className="h-8 text-sm"
        value={node.node_name}
        disabled={!canWrite}
        onChange={(event) => onChange({ node_name: event.target.value })}
      />
      <Select value={node.resolver_type} disabled={!canWrite} onValueChange={(value) => onChange({ resolver_type: value || "" })}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue>{resolverTypeLabel(node.resolver_type)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {resolverOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="min-w-0">
        <Select
          value={node.resolver_role || NONE_VALUE}
          disabled={!canWrite}
          onValueChange={(value) => onChange({ resolver_role: value === NONE_VALUE ? null : value })}
        >
          <SelectTrigger className="h-8 w-full text-sm">
            <SelectValue>{roleDisplayLabel(node.resolver_role)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>未配置</SelectItem>
            {roleOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {roleLabel[option] || option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-1 truncate text-[11px] text-muted-foreground">{node.resolver_role || node.resolver_type}</div>
      </div>
      <Select value={node.approval_policy} disabled={!canWrite} onValueChange={(value) => onChange({ approval_policy: value || "single" })}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue>{approvalPolicyLabel(node.approval_policy)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {policyOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ApprovalFlowConfig({ canWrite }: { canWrite: boolean }) {
  const { data: templates = [], isLoading, isError } = useApprovalTemplates();
  const saveTemplate = useSaveApprovalTemplate();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ApprovalTemplate | null>(null);

  const contractTemplates = useMemo(
    () =>
      templates
        .filter((template) => template.document_type === "contract_approval")
        .sort((a, b) => String(a.business_type).localeCompare(String(b.business_type))),
    [templates],
  );

  const selectedTemplate = contractTemplates.find((template) => template.id === selectedId) || contractTemplates[0] || null;
  const activeDraft = draft?.id === selectedTemplate?.id ? draft : selectedTemplate;

  const updateNode = (nodeId: number, patch: Partial<ApprovalTemplateNode>) => {
    setDraft((current) =>
      (current || activeDraft)
        ? {
            ...(current || activeDraft)!,
            nodes: (current || activeDraft)!.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
          }
        : null,
    );
  };

  const handleSave = () => {
    if (!activeDraft || !canWrite) return;
    saveTemplate.mutate(activeDraft, {
      onSuccess: () => toast.success("审批模板已保存"),
      onError: (error) => toast.error(error instanceof Error ? error.message : "审批模板保存失败"),
    });
  };

  if (isLoading) return <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>;
  if (isError) return <div className="py-10 text-center text-sm text-destructive">审批模板加载失败</div>;

  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4">
      <div className="rounded-lg border border-border bg-card p-2">
        {contractTemplates.map((template) => (
          <button
            key={template.id}
            type="button"
            className={cn(
              "mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-[background-color,color,box-shadow] duration-150 ease-out hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:transition-none",
              activeDraft?.id === template.id && "bg-muted font-semibold",
            )}
            onClick={() => {
              setSelectedId(template.id);
              setDraft(cloneTemplate(template));
            }}
          >
            <div>{templateDisplayName(template)}</div>
            <div className="text-xs text-muted-foreground">{template.template_key}</div>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Input
            className="h-9 max-w-[420px]"
            value={activeDraft?.name || ""}
            disabled={!canWrite}
            onChange={(event) =>
              setDraft((current) =>
                current || activeDraft
                  ? { ...(current || activeDraft)!, name: event.target.value }
                  : current,
              )
            }
          />
          <Button size="sm" onClick={handleSave} disabled={!canWrite || !activeDraft || saveTemplate.isPending}>
            <Save className="mr-1 size-3.5" />
            保存模板
          </Button>
        </div>

        <FlowPreview template={activeDraft} />

        <div className="space-y-2">
          <div className="grid grid-cols-[72px_1.2fr_1fr_1fr_112px] gap-2 px-2 text-xs font-semibold text-muted-foreground">
            <span>顺序</span>
            <span>节点名称</span>
            <span>解析来源</span>
            <span>负责人角色</span>
            <span>策略</span>
          </div>
          {orderedNodes(activeDraft).map((node) => (
            <NodeEditor key={node.id} node={node} canWrite={canWrite} onChange={(patch) => updateNode(node.id, patch)} />
          ))}
        </div>
      </div>
    </div>
  );
}

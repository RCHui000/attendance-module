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

const policyOptions = ["single", "all", "any", "auto_pass"];
const resolverOptions = ["document_creator", "project_role", "org_manager", "fixed_user", "expression_limited"];

const roleLabel: Record<string, string> = {
  submitter: "提交人",
  cc_civil_project_owner: "CC土建项目负责人",
  cc_mep_project_owner: "CC机电项目负责人",
  cc_project_owner: "CC项目负责人",
  cc_department_owner: "CC部门负责人",
  pm_cost_department_owner: "PM成本部负责人",
  pm_project_owner: "PM项目负责人",
  pm_department_owner: "PM部门负责人",
};

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
                "w-[168px] rounded-lg border bg-white px-3 py-3 shadow-sm",
                template.business_type === "PM" && "border-sky-200",
                template.business_type === "CC" && "border-emerald-200",
                template.business_type === "PMCC" && "border-amber-200",
              )}
            >
              <div className="text-sm font-semibold">{node.node_name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {roleLabel[node.resolver_role || ""] || node.resolver_role || node.resolver_type}
              </div>
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
  onChange,
}: {
  node: ApprovalTemplateNode;
  onChange: (patch: Partial<ApprovalTemplateNode>) => void;
}) {
  return (
    <div className="grid grid-cols-[72px_1.2fr_1fr_1fr_112px] items-center gap-2 rounded-md border border-border bg-white p-2">
      <Input
        className="h-8 text-sm"
        type="number"
        value={node.sort_order}
        onChange={(event) => onChange({ sort_order: Number(event.target.value || 0) })}
      />
      <Input
        className="h-8 text-sm"
        value={node.node_name}
        onChange={(event) => onChange({ node_name: event.target.value })}
      />
      <Select value={node.resolver_type} onValueChange={(value) => onChange({ resolver_type: value || "" })}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {resolverOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        className="h-8 text-sm"
        value={node.resolver_role || ""}
        onChange={(event) => onChange({ resolver_role: event.target.value })}
        placeholder="resolver role"
      />
      <Select value={node.approval_policy} onValueChange={(value) => onChange({ approval_policy: value || "single" })}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {policyOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ApprovalFlowConfig() {
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
    if (!activeDraft) return;
    saveTemplate.mutate(activeDraft, {
      onSuccess: () => toast.success("审批模板已保存"),
      onError: (error) => toast.error(error instanceof Error ? error.message : "审批模板保存失败"),
    });
  };

  if (isLoading) return <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>;
  if (isError) return <div className="py-10 text-center text-sm text-destructive">审批模板加载失败</div>;

  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4">
      <div className="rounded-lg border border-border bg-white p-2">
        {contractTemplates.map((template) => (
          <button
            key={template.id}
            type="button"
            className={cn(
              "mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
              activeDraft?.id === template.id && "bg-muted font-semibold",
            )}
            onClick={() => {
              setSelectedId(template.id);
              setDraft(cloneTemplate(template));
            }}
          >
            <div>{template.business_type || "通用"} 合同</div>
            <div className="text-xs text-muted-foreground">{template.template_key}</div>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Input
            className="h-9 max-w-[420px]"
            value={activeDraft?.name || ""}
            onChange={(event) =>
              setDraft((current) =>
                current || activeDraft
                  ? { ...(current || activeDraft)!, name: event.target.value }
                  : current,
              )
            }
          />
          <Button size="sm" onClick={handleSave} disabled={!activeDraft || saveTemplate.isPending}>
            <Save className="mr-1 size-3.5" />
            保存模板
          </Button>
        </div>

        <FlowPreview template={activeDraft} />

        <div className="space-y-2">
          <div className="grid grid-cols-[72px_1.2fr_1fr_1fr_112px] gap-2 px-2 text-xs font-semibold text-muted-foreground">
            <span>顺序</span>
            <span>节点名称</span>
            <span>解析器</span>
            <span>角色键</span>
            <span>策略</span>
          </div>
          {orderedNodes(activeDraft).map((node) => (
            <NodeEditor key={node.id} node={node} onChange={(patch) => updateNode(node.id, patch)} />
          ))}
        </div>
      </div>
    </div>
  );
}

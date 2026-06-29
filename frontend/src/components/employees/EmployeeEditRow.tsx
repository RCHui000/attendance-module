import { memo, useCallback, useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Employee, Organization } from "@/types/employee";
import { isoDate } from "@/utils/dates";
import { flattenOrgTree, isCostOrganization, orgOptionLabel } from "@/utils/orgTree";

interface EmployeeEditData {
  id: number;
  employeeNo: string;
  name: string;
  role: string;
  orgId: string;
  positionName: string;
  costSpecialty: string;
  contractType: "labor" | "service";
  monthlySalary: string;
  dailyWage: string;
  hireDate: string;
  contractMonths: string;
  managerUserId: string;
  status: "active" | "terminated";
  auditScopeOrgIds: string[];
}

export type { EmployeeEditData };

interface EmployeeEditRowProps {
  item: Employee | null; // null = new row
  data: EmployeeEditData;
  orgs: Organization[];
  employees: Employee[];
  isNew: boolean;
  canEditRole?: boolean;
  canEditAuditScopes?: boolean;
  onChange: (update: Partial<EmployeeEditData>) => void;
  onNameBlur?: (name: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function calculateMonths(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 12;
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.max(
    (end.getFullYear() - start.getFullYear()) * 12 +
      end.getMonth() -
      start.getMonth() +
      1,
    1,
  );
}

function inferCostSpecialty(positionName: string): string {
  if (positionName.includes("土建")) return "civil";
  if (positionName.includes("机电")) return "mep";
  if (positionName.includes("全专业")) return "all";
  return "";
}

function costSpecialtyLabel(value: string): string {
  if (value === "civil") return "土建";
  if (value === "mep") return "机电";
  if (value === "all") return "全专业";
  return "";
}

function requiresConsultingSpecialty(role: string): boolean {
  return role === "employee" || role === "lead";
}

export const EmployeeEditRow = memo(function EmployeeEditRow({
  data,
  orgs,
  canEditRole = true,
  canEditAuditScopes = false,
  onChange,
  onNameBlur,
  onSave,
  onCancel,
}: EmployeeEditRowProps) {
  const departmentOrgs = useMemo(
    () => flattenOrgTree(orgs).filter((o) => o.org_type !== "company"),
    [orgs],
  );

  const showCostSpecialty = useMemo(
    () =>
      requiresConsultingSpecialty(data.role) &&
      isCostOrganization(orgs, data.orgId ? Number(data.orgId) : null),
    [orgs, data.orgId, data.role],
  );

  const effectiveCostSpecialty = data.costSpecialty || inferCostSpecialty(data.positionName);

  const handleContractTypeChange = useCallback(
    (value: string) => {
      const ct = value as "labor" | "service";
      onChange({ contractType: ct });
    },
    [onChange],
  );

  const handleOrgChange = useCallback(
    (value: string) => {
      const shouldKeepSpecialty = isCostOrganization(orgs, value ? Number(value) : null);
      const shouldUseSpecialty = shouldKeepSpecialty && requiresConsultingSpecialty(data.role);
      const nextSpecialty = shouldUseSpecialty
        ? data.costSpecialty || inferCostSpecialty(data.positionName)
        : "";
      onChange({
        orgId: value,
        costSpecialty: nextSpecialty,
        positionName: shouldUseSpecialty ? costSpecialtyLabel(nextSpecialty) : data.positionName,
      });
    },
    [data.costSpecialty, data.positionName, data.role, orgs, onChange],
  );

  const handleHireDateChange = useCallback(
    (value: string) => {
      onChange({ hireDate: value, contractMonths: data.contractMonths });
    },
    [data.contractMonths, onChange],
  );

  const handleContractMonthsChange = useCallback(
    (value: string) => {
      onChange({ contractMonths: value });
    },
    [onChange],
  );

  const toggleAuditScopeOrg = useCallback(
    (orgId: string) => {
      const selected = new Set(data.auditScopeOrgIds || []);
      if (selected.has(orgId)) {
        selected.delete(orgId);
      } else {
        selected.add(orgId);
      }
      onChange({ auditScopeOrgIds: Array.from(selected) });
    },
    [data.auditScopeOrgIds, onChange],
  );

  const salaryField =
    data.contractType === "service" ? (
      <Input
        className="h-9 text-sm text-right"
        type="number"
        min="0"
        placeholder="日薪"
        aria-label="日薪"
        value={data.dailyWage}
        onChange={(e) => onChange({ dailyWage: e.target.value })}
      />
    ) : (
      <Input
        className="h-9 text-sm text-right"
        type="number"
        min="0"
        placeholder="月薪"
        aria-label="月薪"
        value={data.monthlySalary}
        onChange={(e) => onChange({ monthlySalary: e.target.value })}
      />
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="员工编号">
        <Input
          className="h-9 text-sm"
          autoComplete="off"
          aria-label="员工编号"
          value={data.employeeNo}
          onChange={(e) => onChange({ employeeNo: e.target.value })}
        />
        </Field>

        <Field label="姓名">
        <Input
          className="h-9 text-sm"
          autoComplete="off"
          aria-label="姓名"
          value={data.name}
          onChange={(e) => onChange({ name: e.target.value })}
          onBlur={(e) => onNameBlur?.(e.target.value)}
          placeholder="必填"
        />
        </Field>

        <Field label="权限角色">
        <Select
          value={data.role || "employee"}
          onValueChange={(v) => onChange({ role: v || "employee" })}
          disabled={!canEditRole}
        >
          <SelectTrigger className="h-9 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent layer="modal">
            <SelectItem value="employee">员工</SelectItem>
            <SelectItem value="lead">基层负责人</SelectItem>
            <SelectItem value="manager">主管</SelectItem>
            <SelectItem value="director">董事</SelectItem>
            <SelectItem value="admin">管理员</SelectItem>
          </SelectContent>
        </Select>
        </Field>

        <Field label="部门">
        <Select value={data.orgId} onValueChange={(v) => handleOrgChange(v || "")}>
          <SelectTrigger className="h-9 w-full text-sm">
            <SelectValue placeholder="部门" />
          </SelectTrigger>
          <SelectContent layer="modal">
            {departmentOrgs.map((org) => (
              <SelectItem key={org.id} value={String(org.id)}>
                {orgOptionLabel(org)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        </Field>

        <Field label="岗位">
        {showCostSpecialty ? (
          <Select
            value={effectiveCostSpecialty || "none"}
            onValueChange={(v) => {
              const nextValue = v || "none";
              const next = nextValue === "none" ? "" : nextValue;
              onChange({
                costSpecialty: next,
                positionName: costSpecialtyLabel(next),
              });
            }}
          >
            <SelectTrigger className="h-9 w-full text-sm" aria-label="造价岗位">
              <SelectValue placeholder="岗位" />
            </SelectTrigger>
            <SelectContent layer="modal">
              <SelectItem value="none">未设</SelectItem>
              <SelectItem value="civil">土建</SelectItem>
              <SelectItem value="mep">机电</SelectItem>
              <SelectItem value="all">全专业</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            className="h-9 text-sm"
            autoComplete="off"
            aria-label="岗位"
            value={data.positionName}
            onChange={(e) => onChange({ positionName: e.target.value })}
          />
        )}
        </Field>

        <Field label="合同类型">
        <Select value={data.contractType} onValueChange={(v) => handleContractTypeChange((v || "labor") as "labor" | "service")}>
          <SelectTrigger className="h-9 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent layer="modal">
            <SelectItem value="labor">劳动合同</SelectItem>
            <SelectItem value="service">劳务合同</SelectItem>
          </SelectContent>
        </Select>
        </Field>

        <Field label={data.contractType === "service" ? "日薪" : "月薪"}>
          {salaryField}
        </Field>

        <Field label="聘用期" className="sm:col-span-2">
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
          <Input
            type="date"
            className="h-9 text-sm"
            aria-label="入职日期"
            value={data.hireDate}
            onChange={(e) => handleHireDateChange(e.target.value)}
          />
          <Input
            type="number"
            className="h-9 text-sm"
            min="1"
            aria-label="合同时长（月）"
            title="合同时长（月）"
            value={data.contractMonths}
            onChange={(e) => handleContractMonthsChange(e.target.value)}
          />
        </div>
        </Field>

        <Field label="状态">
        <Select value={data.status} onValueChange={(v) => onChange({ status: v as "active" | "terminated" })}>
          <SelectTrigger className="h-9 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent layer="modal">
            <SelectItem value="active">在职</SelectItem>
            <SelectItem value="terminated">离职</SelectItem>
          </SelectContent>
        </Select>
        </Field>

        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          工龄：
          <span className="font-medium text-foreground">
            {data.hireDate
              ? (() => {
                  const total = calculateMonths(data.hireDate, isoDate(new Date()));
                  return total < 12 ? `${total}个月` : `${Math.floor(total / 12)}年`;
                })()
              : "-"}
          </span>
        </div>

        {canEditAuditScopes && (
          <Field label="审批审计可见范围" className="sm:col-span-2">
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-card p-2">
              {departmentOrgs.map((org) => {
                const value = String(org.id);
                return (
                  <label
                    key={org.id}
                    className="flex min-h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input accent-primary"
                      checked={(data.auditScopeOrgIds || []).includes(value)}
                      onChange={() => toggleAuditScopeOrg(value)}
                    />
                    <span className="min-w-0 truncate">{orgOptionLabel(org)}</span>
                  </label>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              仅增加已审核周表的只读可见范围，不产生待审批任务。
            </p>
          </Field>
        )}
      </div>

      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t bg-muted/40 px-4 py-3">
        <Button size="sm" variant="outline" className="rounded-full" onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" className="rounded-full" onClick={onSave}>
          保存
        </Button>
      </div>
    </div>
  );
});

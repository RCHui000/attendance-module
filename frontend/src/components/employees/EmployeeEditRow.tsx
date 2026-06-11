import { memo, useCallback, useMemo } from "react";
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
}

export type { EmployeeEditData };

interface EmployeeEditRowProps {
  item: Employee | null; // null = new row
  data: EmployeeEditData;
  orgs: Organization[];
  employees: Employee[];
  isNew: boolean;
  canEditRole?: boolean;
  onChange: (update: Partial<EmployeeEditData>) => void;
  onSave: () => void;
  onCancel: () => void;
}

function isManagement(item: Employee): boolean {
  return item.role === "manager" || item.role === "admin";
}

function getManagerOptions(
  orgId: string,
  selectedId: string,
  excludeId: number | null,
  employees: Employee[],
) {
  // First, management staff in the selected org
  let scoped = employees.filter((e) => {
    if (!isManagement(e)) return false;
    if (orgId && String(e.org_id) !== String(orgId)) return false;
    if (excludeId && e.id === excludeId) return false;
    return true;
  });
  // Fallback: all management staff
  if (scoped.length === 0) {
    scoped = employees.filter((e) => {
      if (!isManagement(e)) return false;
      if (excludeId && e.id === excludeId) return false;
      return true;
    });
  }
  return scoped;
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
  return "";
}

function costSpecialtyLabel(value: string): string {
  if (value === "civil") return "土建";
  if (value === "mep") return "机电";
  return "";
}

export const EmployeeEditRow = memo(function EmployeeEditRow({
  item,
  data,
  orgs,
  employees,
  canEditRole = true,
  onChange,
  onSave,
  onCancel,
}: EmployeeEditRowProps) {
  const departmentOrgs = useMemo(
    () => flattenOrgTree(orgs).filter((o) => o.org_type !== "company"),
    [orgs],
  );

  const showCostSpecialty = useMemo(
    () => isCostOrganization(orgs, data.orgId ? Number(data.orgId) : null),
    [orgs, data.orgId],
  );

  const effectiveCostSpecialty = data.costSpecialty || inferCostSpecialty(data.positionName);

  const managerOptions = useMemo(
    () =>
      getManagerOptions(data.orgId, data.managerUserId, item?.id ?? null, employees),
    [data.orgId, data.managerUserId, item?.id, employees],
  );

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
      const nextSpecialty = shouldKeepSpecialty ? data.costSpecialty || inferCostSpecialty(data.positionName) : "";
      // Reset manager when org changes
      const scoped = getManagerOptions(value, "", item?.id ?? null, employees);
      onChange({
        orgId: value,
        managerUserId: scoped[0] ? String(scoped[0].id) : "",
        costSpecialty: nextSpecialty,
        positionName: shouldKeepSpecialty ? costSpecialtyLabel(nextSpecialty) : data.positionName,
      });
    },
    [data.costSpecialty, data.positionName, item?.id, employees, orgs, onChange],
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

  const salaryField =
    data.contractType === "service" ? (
      <Input
        className="h-8 text-sm text-right w-[82px]"
        type="number"
        min="0"
        placeholder="日薪"
        aria-label="日薪"
        value={data.dailyWage}
        onChange={(e) => onChange({ dailyWage: e.target.value })}
      />
    ) : (
      <Input
        className="h-8 text-sm text-right w-[82px]"
        type="number"
        min="0"
        placeholder="月薪"
        aria-label="月薪"
        value={data.monthlySalary}
        onChange={(e) => onChange({ monthlySalary: e.target.value })}
      />
    );

  return (
    <tr className="bg-row-selected">
      {/* Actions */}
      <td className="p-1.5 sticky left-0 bg-row-selected z-[5]">
        <div className="flex gap-1">
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={onSave}
          >
            保存
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={onCancel}
          >
            取消
          </Button>
        </div>
      </td>

      {/* Employee No */}
      <td className="p-1.5">
        <Input
          className="h-8 text-sm w-[80px]"
          autoComplete="off"
          aria-label="员工编号"
          value={data.employeeNo}
          onChange={(e) => onChange({ employeeNo: e.target.value })}
        />
      </td>

      {/* Name */}
      <td className="p-1.5">
        <Input
          className="h-8 text-sm w-[80px]"
          autoComplete="off"
          aria-label="姓名"
          value={data.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="必填"
        />
      </td>

      {/* Role */}
      <td className="p-1.5">
        <Select
          value={data.role || "employee"}
          onValueChange={(v) => onChange({ role: v || "employee" })}
          disabled={!canEditRole}
        >
          <SelectTrigger className="h-8 text-sm w-[88px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="employee">员工</SelectItem>
            <SelectItem value="manager">主管</SelectItem>
            <SelectItem value="admin">管理员</SelectItem>
          </SelectContent>
        </Select>
      </td>

      {/* Department / Org */}
      <td className="p-1.5">
        <Select value={data.orgId} onValueChange={(v) => handleOrgChange(v || "")}>
          <SelectTrigger className="h-8 text-sm w-[108px]">
            <SelectValue placeholder="部门" />
          </SelectTrigger>
          <SelectContent>
            {departmentOrgs.map((org) => (
              <SelectItem key={org.id} value={String(org.id)}>
                {orgOptionLabel(org)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>

      {/* Position */}
      <td className="p-1.5">
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
            <SelectTrigger className="h-8 text-sm w-[88px]" aria-label="造价岗位">
              <SelectValue placeholder="岗位" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">未设</SelectItem>
              <SelectItem value="civil">土建</SelectItem>
              <SelectItem value="mep">机电</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            className="h-8 text-sm w-[80px]"
            autoComplete="off"
            aria-label="岗位"
            value={data.positionName}
            onChange={(e) => onChange({ positionName: e.target.value })}
          />
        )}
      </td>

      {/* Contract Type */}
      <td className="p-1.5">
        <Select value={data.contractType} onValueChange={(v) => handleContractTypeChange((v || "labor") as "labor" | "service")}>
          <SelectTrigger className="h-8 text-sm w-[90px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="labor">劳动合同</SelectItem>
            <SelectItem value="service">劳务合同</SelectItem>
          </SelectContent>
        </Select>
      </td>

      {/* Salary */}
      <td className="p-1.5">{salaryField}</td>

      {/* Employment Period: hire date + contract months */}
      <td className="p-1.5">
        <div className="flex gap-1.5">
          <Input
            type="date"
            className="h-8 text-sm w-[108px]"
            aria-label="入职日期"
            value={data.hireDate}
            onChange={(e) => handleHireDateChange(e.target.value)}
          />
          <Input
            type="number"
            className="h-8 text-sm w-[64px]"
            min="1"
            aria-label="合同时长（月）"
            title="合同时长（月）"
            value={data.contractMonths}
            onChange={(e) => handleContractMonthsChange(e.target.value)}
          />
        </div>
      </td>

      {/* Tenure (calculated, not editable) */}
      <td className="p-1.5 text-sm text-muted-foreground text-right tabular-nums">
        {data.hireDate ? (
          (() => {
            const total = calculateMonths(data.hireDate, new Date().toISOString().slice(0, 10));
            return total < 12 ? `${total}个月` : `${Math.floor(total / 12)}年`;
          })()
        ) : (
          "—"
        )}
      </td>

      {/* Manager */}
      <td className="p-1.5">
        <Select
          value={data.managerUserId || "none"}
          onValueChange={(v) => onChange({ managerUserId: !v || v === "none" ? "" : v })}
        >
          <SelectTrigger className="h-8 text-sm w-[108px]">
            <SelectValue placeholder="直属领导" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">未设置</SelectItem>
            {managerOptions.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {e.name} · {e.org_name || e.department || "—"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>

      {/* Status */}
      <td className="p-1.5">
        <Select value={data.status} onValueChange={(v) => onChange({ status: v as "active" | "terminated" })}>
          <SelectTrigger className="h-8 text-sm w-[72px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">在职</SelectItem>
            <SelectItem value="terminated">解聘</SelectItem>
          </SelectContent>
        </Select>
      </td>
    </tr>
  );
});

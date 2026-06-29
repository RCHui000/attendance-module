import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmployeeEditRow, type EmployeeEditData } from "./EmployeeEditRow";
import type { Organization } from "@/types/employee";

const baseData: EmployeeEditData = {
  id: 1,
  employeeNo: "QS26001",
  name: "测试员工",
  role: "employee",
  orgId: "12",
  positionName: "土建",
  costSpecialty: "civil",
  contractType: "labor",
  monthlySalary: "10000",
  dailyWage: "0",
  hireDate: "2026-01-01",
  contractMonths: "12",
  managerUserId: "",
  status: "active",
  auditScopeOrgIds: ["12"],
};

const orgs: Organization[] = [
  {
    id: 1,
    org_code: "COMP",
    org_name: "公司",
    parent_id: null,
    org_type: "company",
    status: "active",
  },
  {
    id: 12,
    org_code: "CC",
    org_name: "造价咨询部",
    parent_id: 1,
    org_type: "department",
    status: "active",
  },
];

function renderEmployeeEditRow(canEditAuditScopes: boolean) {
  return render(
    <EmployeeEditRow
      item={null}
      data={baseData}
      orgs={orgs}
      employees={[]}
      isNew={false}
      canEditRole
      canEditAuditScopes={canEditAuditScopes}
      onChange={vi.fn()}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe("EmployeeEditRow audit scope visibility", () => {
  it("hides approval audit scope controls from non-admin editors", () => {
    renderEmployeeEditRow(false);

    expect(screen.queryByText("审批审计可见范围")).not.toBeInTheDocument();
    expect(screen.queryByText("仅增加已审核周表的只读可见范围，不产生待审批任务。")).not.toBeInTheDocument();
  });

  it("shows approval audit scope controls to admin editors", () => {
    renderEmployeeEditRow(true);

    expect(screen.getByText("审批审计可见范围")).toBeInTheDocument();
    expect(screen.getByLabelText(/造价咨询部/)).toBeChecked();
  });
});

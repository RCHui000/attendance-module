# Employees And Organizations Module

This module manages employees, current HR profiles, platform roles, salary/contract fields, the configurable organization tree, and resource-level permissions.

## Entry Points

| File | Role |
| --- | --- |
| `pages/EmployeesPage.tsx` | Page orchestration and tabs. |
| `EmployeeTable.tsx` | Employee grid. |
| `EmployeeEditRow.tsx` | Inline employee editor. |
| `OrganizationPanel.tsx` | Organization tree and manager selection. |
| `PermissionConfigPanel.tsx` | Platform role permission matrix. |
| `ReminderFloat.tsx` | Floating reminders for expiring/invalid records. |
| `hooks/useEmployees.ts` | Query/mutation wrappers. |
| `types/employee.ts` | Employee contracts. |

## API Calls

| Hook / Caller | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| `useEmployees` | `/api/employees` | GET | Load active employees with current profile, salary, contract, role. |
| `useSaveEmployee` | `/api/employees/save` | POST | Create/update employee. New employees create GoTrue login. |
| `useDeleteEmployee` | `/api/employees/delete` | POST | Soft deactivate employee and mark profile terminated. |
| `useOrganizations` | `/api/organizations` | GET | Load active organization tree with manager names. |
| `useSaveOrganization` | `/api/organizations/save` | POST | Create/update organization. |
| `useDeleteOrganization` | `/api/organizations/delete` | POST | Soft delete organization. |
| `usePermissionConfig` | `/api/permissions` | GET | Load platform roles, resources, and role-resource access levels. |
| `useSavePermissionConfig` | `/api/permissions/save` | POST | Save one role's resource access level. |

## Data Model

- `employees`: core employee row and auth link.
- `profiles`: login name and GoTrue identity mapping.
- `employee_profiles`: organization, position, cost specialty, status, manager.
- `employee_contracts`: contract type and date range.
- `employee_salary_profiles`: monthly salary or service daily wage.
- `user_roles`: platform role assignment, one of `employee`, `lead`, `manager`, `director`, `admin`.
- `permission_roles`: configurable role labels and ordering.
- `permission_resources`: configurable resource catalog for sidebar and employee-org subpages.
- `role_permissions`: per-role access level: `none`, `read`, or `write`.
- `organizations`: multi-level tree node and department manager.

## Organization And Specialty Rules

- `organizations.parent_id` supports configurable multi-level departments.
- The current seeded structure has two top-level departments: `项目管理` and `成本合约`.
- `项目管理` has three second-level departments: `设计`, `管理`, and `成本`; this `成本` node is internal to 项目管理 and is not the same as the top-level `成本合约` department.
- Organization selectors render departments as a tree and store only the selected organization id.
- Employees under the top-level `成本合约` line use a constrained position selector only when their platform role is `employee`: `土建` or `机电`.
- Cost contract department heads and approval participants do not need a cost specialty unless they also act as execution/project-owner employees.
- The constrained cost position is stored as `employee_profiles.cost_specialty`: `civil` for 土建 and `mep` for 机电.
- Future approval routing can use `cost_specialty` for the first cost-review route to each discipline's cost project owner.

## Permission Notes

- Platform permissions are independent from approval participants. Project owners and department owners are configured through organization/project data and Approval Graph assignees, not through `user_roles`.
- `system_management` controls the employee/organization system-management tab.
- `permission_config` controls the role permission matrix tab.
- `review` controls approval-center entry; actual approval actions still require the current employee to be assigned in `approval_node_assignees`.
- GoTrue signup is disabled; new accounts go through `/api/create-employee-with-login`.
- Deletes are soft deletes to preserve historical timesheets and approvals.

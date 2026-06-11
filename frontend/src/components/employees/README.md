# Employees And Organizations Module

This module manages employees, current HR profiles, roles, salary/contract fields, and the organization tree.

## Entry Points

| File | Role |
| --- | --- |
| `pages/EmployeesPage.tsx` | Page orchestration and tabs. |
| `EmployeeTable.tsx` | Employee grid. |
| `EmployeeEditRow.tsx` | Inline employee editor. |
| `OrganizationPanel.tsx` | Organization tree and manager selection. |
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

## Data Model

- `employees`: core employee row and auth link.
- `profiles`: login name and GoTrue identity mapping.
- `employee_profiles_v2`: organization, position, status, manager.
- `employee_contracts`: contract type and date range.
- `employee_salary_profiles`: monthly salary or service daily wage.
- `user_roles`: `employee`, `manager`, `admin`.
- `organizations`: tree node and department manager.

## Permission Notes

- Admin can manage all employees and organizations.
- Department managers can manage employees inside their department/subtree according to RLS.
- GoTrue signup is disabled; new accounts go through `/api/create-employee-with-login`.
- Deletes are soft deletes to preserve historical timesheets and approvals.

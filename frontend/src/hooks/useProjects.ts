import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  DashboardAnalysisData,
  DashboardAnalysisGrain,
  DashboardData,
  DashboardProject,
  LaborMatrixRow,
  ProjectBase,
} from "@/types/project";

export function useDashboard(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["dashboard", "v2", startDate, endDate],
    queryFn: async () => {
      const [projectBase, laborMatrix] = await Promise.all([
        api<ProjectBase[]>("/api/projects"),
        api<LaborMatrixRow[]>(
          `/api/reports/labor-matrix?startDate=${startDate}&endDate=${endDate}`,
        ),
      ]);

      const laborMap = new Map<
        number,
        { totalHours: number; laborCost: number; employeeIds: Set<number> }
      >();
      let totalLaborHoursAll = 0;
      let totalLaborCostAll = 0;
      const employeeIdsAll = new Set<number>();

      for (const row of laborMatrix || []) {
        const projectId = row.project_id;
        const totalHours = Number(row.total_hours || 0);
        const laborCost = Number(row.labor_cost || 0);
        const employeeId = row.employee_id;
        const labor = laborMap.get(projectId) || {
          totalHours: 0,
          laborCost: 0,
          employeeIds: new Set<number>(),
        };

        labor.totalHours += totalHours;
        labor.laborCost += laborCost;
        labor.employeeIds.add(employeeId);
        laborMap.set(projectId, labor);

        totalLaborHoursAll += totalHours;
        totalLaborCostAll += laborCost;
        employeeIdsAll.add(employeeId);
      }

      const projects: DashboardProject[] = (projectBase || [])
        .filter((p) => p.status !== "deleted" && p.work_kind !== "leave")
        .map((p) => {
          const labor = laborMap.get(p.id) || {
            totalHours: 0,
            laborCost: 0,
            employeeIds: new Set<number>(),
          };
          const contractAmount = p.contract_amount || 0;
          const receivedAmount = p.received_amount || 0;
          const receivableAmount =
            p.receivable_amount ?? contractAmount - receivedAmount;
          const projLaborCost = labor.laborCost;
          const projGrossProfit = contractAmount - projLaborCost;
          const projGrossMargin = contractAmount > 0
            ? (projGrossProfit / contractAmount) * 100
            : 0;

          return {
            id: p.id,
            code: p.code,
            name: p.name,
            contract_amount: contractAmount,
            received_amount: receivedAmount,
            receivable_amount: receivableAmount,
            labor_days: labor.totalHours,
            labor_cost: projLaborCost,
            gross_profit: projGrossProfit,
            gross_margin: projGrossMargin,
            people_count: labor.employeeIds.size,
            planned_labor_days: p.planned_labor_days || 0,
            labor_budget_amount: p.labor_budget_amount || 0,
          };
        });

      return {
        projects,
        totalLaborHours: totalLaborHoursAll,
        totalLaborCost: totalLaborCostAll,
        totalPeople: employeeIdsAll.size,
      } as DashboardData;
    },
    enabled: !!(startDate && endDate),
    placeholderData: (previousData) => previousData,
  });
}

export function useDashboardAnalysis(startDate: string, endDate: string, grain: DashboardAnalysisGrain) {
  return useQuery({
    queryKey: ["dashboard", "analysis", startDate, endDate, grain],
    queryFn: () =>
      api<DashboardAnalysisData>(
        `/api/dashboard/analysis?startDate=${startDate}&endDate=${endDate}&grain=${grain}`,
      ),
    enabled: !!(startDate && endDate && grain),
    placeholderData: (previousData) => previousData,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ["all-projects"],
    queryFn: () => api<ProjectBase[]>("/api/projects"),
  });
}

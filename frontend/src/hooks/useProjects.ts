import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DashboardData, DashboardProject, ProjectBase, ReportData } from "@/types/project";
import type { Employee } from "@/types/employee";

interface EmployeeWage {
  contract_type: string;
  monthly_salary: number;
  daily_wage: number;
  standard_monthly_workdays: number;
}

function dailyRate(emp: EmployeeWage): number {
  if (emp.contract_type === "service") {
    return emp.daily_wage || 0;
  }
  // labor contract: monthly / standard_workdays
  const workdays = emp.standard_monthly_workdays || 21.75;
  return (emp.monthly_salary || 0) / workdays;
}

export function useDashboard(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["dashboard", startDate, endDate],
    queryFn: async () => {
      // Fetch all sources in parallel
      const [projectBase, reportData, employees] = await Promise.all([
        api<ProjectBase[]>("/api/projects"),
        api<ReportData>(
          `/api/reports/weekly?startDate=${startDate}&endDate=${endDate}`,
        ),
        api<Employee[]>("/api/employees"),
      ]);

      // Build employee wage lookup: employee name → daily rate
      const wageByName = new Map<string, number>();
      for (const emp of employees || []) {
        wageByName.set(emp.name, dailyRate({
          contract_type: emp.contract_type,
          monthly_salary: Number(emp.monthly_salary || 0),
          daily_wage: Number(emp.daily_wage || 0),
          standard_monthly_workdays: emp.standard_monthly_workdays,
        }));
      }

      // Build a map of project code → report labor data
      const laborMap = new Map<
        string,
        { totalHours: number; peopleCount: number }
      >();
      let totalLaborHoursAll = 0;
      let totalPeopleAll = 0;

      for (const p of reportData.projects || []) {
        laborMap.set(p.code, {
          totalHours: p.total_hours || 0,
          peopleCount: p.people_count || 0,
        });
        totalLaborHoursAll += p.total_hours || 0;
        totalPeopleAll += 1;
      }

      // Compute total labor cost from employee-level report data
      let totalLaborCostAll = 0;
      for (const emp of reportData.employees || []) {
        const rate = wageByName.get(emp.name) || 0;
        totalLaborCostAll += (emp.total_hours || 0) * rate;
      }

      // Merge project base (contract) + report (labor) data
      // Distribute total labor cost proportionally to project hours
      const costRate = totalLaborHoursAll > 0
        ? totalLaborCostAll / totalLaborHoursAll
        : 0;

      const projects: DashboardProject[] = (projectBase || [])
        .filter((p) => p.status !== "deleted")
        .map((p) => {
          const labor = laborMap.get(p.code) || {
            totalHours: 0,
            peopleCount: 0,
          };
          const contractAmount = p.contract_amount || 0;
          const receivedAmount = p.received_amount || 0;
          const receivableAmount =
            p.receivable_amount ?? contractAmount - receivedAmount;
          const projLaborCost = Math.round(labor.totalHours * costRate);
          const projGrossProfit = contractAmount - projLaborCost;
          const projGrossMargin = contractAmount > 0
            ? ((projGrossProfit / contractAmount) * 100)
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
            people_count: labor.peopleCount,
          };
        });

      return {
        projects,
        totalLaborHours: totalLaborHoursAll,
        totalLaborCost: totalLaborCostAll,
        totalPeople: totalPeopleAll,
      } as DashboardData;
    },
    enabled: !!(startDate && endDate),
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ["all-projects"],
    queryFn: () => api<ProjectBase[]>("/api/projects"),
  });
}

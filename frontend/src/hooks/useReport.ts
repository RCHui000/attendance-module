import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  ReportData,
  ProjectBase,
  ProjectDetailEmployee,
} from "@/types/project";

export function useWeeklyReport(params: {
  startDate: string;
  endDate: string;
}) {
  return useQuery({
    queryKey: ["reports", params.startDate, params.endDate],
    queryFn: () =>
      api<ReportData>(
        `/api/reports/weekly?startDate=${params.startDate}&endDate=${params.endDate}`,
      ),
    enabled: !!(params.startDate && params.endDate),
  });
}

export function useProjectBase() {
  return useQuery({
    queryKey: ["project-base"],
    queryFn: () => api<ProjectBase[]>("/api/projects"),
  });
}

export function useProjectDetail(
  projectId: number | null,
  startDate: string,
  endDate: string,
) {
  return useQuery({
    queryKey: ["project-detail", projectId, startDate, endDate],
    queryFn: () =>
      api<ProjectDetailEmployee[]>(
        `/api/project-detail?projectId=${projectId}&startDate=${startDate}&endDate=${endDate}`,
      ),
    enabled: !!(projectId && startDate && endDate),
  });
}

export function useSaveProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      id?: number;
      code: string;
      name: string;
      contractAmount?: number;
      receivedAmount?: number;
    }) =>
      api("/api/projects/save", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-base"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api("/api/projects/delete", {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-base"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

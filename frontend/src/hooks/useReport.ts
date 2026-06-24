import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { publishLocalSync } from "@/hooks/useRealtime";
import type {
  LaborMatrixRow,
  ReportData,
  ProjectBase,
  ProjectDetailEmployee,
  ProjectRoleRequirement,
} from "@/types/project";

type SaveProjectParams = {
  id?: number;
  code: string;
  name: string;
  signedDate?: string;
  contractAmount?: number;
  receivedAmount?: number;
  businessType?: "PM" | "CC" | "PMCC";
  projectOwnerId?: number;
  departmentOwners?: {
    id?: number;
    org_id: number;
    project_owner_id: number;
  }[];
  projectRoles?: {
    role_key: string;
    user_id: number;
  }[];
};

type SaveProjectResult = {
  ok?: boolean;
  projects?: ProjectBase[];
};

function patchProjectList(
  projects: ProjectBase[] | undefined,
  params: SaveProjectParams,
) {
  if (!projects || !params.id) return projects;
  const projectId = Number(params.id);
  const contractAmount = Number(params.contractAmount || 0);
  const receivedAmount = Number(params.receivedAmount || 0);

  return projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          code: params.code,
          name: params.name,
          signed_date: params.signedDate || null,
          business_type: params.businessType || project.business_type,
          contract_amount: contractAmount,
          received_amount: receivedAmount,
          receivable_amount: Math.max(contractAmount - receivedAmount, 0),
          project_owner_id: params.projectOwnerId ?? project.project_owner_id,
        }
      : project,
  );
}

function invalidateLater(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKeys: unknown[][],
  delayMs = 2500,
) {
  window.setTimeout(() => {
    queryKeys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
  }, delayMs);
}

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
    staleTime: 60_000,
  });
}

export function useProjectRoleRequirements(businessType?: "PM" | "CC" | "PMCC" | null) {
  return useQuery({
    queryKey: ["project-role-requirements", businessType || "all"],
    queryFn: () =>
      api<ProjectRoleRequirement[]>(
        `/api/project-role-requirements${businessType ? `?businessType=${businessType}` : ""}`,
      ),
    staleTime: 10 * 60_000,
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

export function useLaborMatrix(params: {
  startDate: string;
  endDate: string;
}) {
  return useQuery({
    queryKey: ["reports", "labor-matrix", params.startDate, params.endDate],
    queryFn: () =>
      api<LaborMatrixRow[]>(
        `/api/reports/labor-matrix?startDate=${params.startDate}&endDate=${params.endDate}`,
    ),
    enabled: !!(params.startDate && params.endDate),
  });
}

export function useSaveProject() {
  const queryClient = useQueryClient();
  return useMutation<
    SaveProjectResult,
    Error,
    SaveProjectParams,
    { previousProjectBase?: ProjectBase[]; previousAllProjects?: ProjectBase[] }
  >({
    mutationFn: (params) =>
      api<SaveProjectResult>("/api/projects/save", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onMutate: async (params) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["project-base"] }),
        queryClient.cancelQueries({ queryKey: ["all-projects"] }),
      ]);

      const previousProjectBase = queryClient.getQueryData<ProjectBase[]>(["project-base"]);
      const previousAllProjects = queryClient.getQueryData<ProjectBase[]>(["all-projects"]);

      queryClient.setQueryData<ProjectBase[]>(["project-base"], (projects) => patchProjectList(projects, params));
      queryClient.setQueryData<ProjectBase[]>(["all-projects"], (projects) => patchProjectList(projects, params));

      return { previousProjectBase, previousAllProjects };
    },
    onError: (_error, _params, context) => {
      if (context?.previousProjectBase) queryClient.setQueryData(["project-base"], context.previousProjectBase);
      if (context?.previousAllProjects) queryClient.setQueryData(["all-projects"], context.previousAllProjects);
    },
    onSuccess: (result) => {
      if (result.projects) {
        queryClient.setQueryData(["project-base"], result.projects);
        queryClient.setQueryData(["all-projects"], result.projects);
      } else {
        queryClient.invalidateQueries({ queryKey: ["project-base"] });
        queryClient.invalidateQueries({ queryKey: ["all-projects"] });
      }

      invalidateLater(queryClient, [["employees"], ["approvals"], ["reports"], ["dashboard"]]);
      publishLocalSync(["projects", "employees"]);
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
      queryClient.invalidateQueries({ queryKey: ["all-projects"] });
      invalidateLater(queryClient, [["reports"], ["dashboard"]]);
      publishLocalSync(["projects"]);
    },
  });
}

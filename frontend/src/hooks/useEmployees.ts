import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { publishLocalSync } from "@/hooks/useRealtime";
import type { Employee, Organization, PermissionConfig } from "@/types/employee";

export function useEmployees() {
  return useQuery({
    queryKey: ["employees"],
    queryFn: () => api<Employee[]>("/api/employees"),
  });
}

export function useOrganizations() {
  return useQuery({
    queryKey: ["organizations"],
    queryFn: () => api<Organization[]>("/api/organizations"),
  });
}

export function usePermissionConfig() {
  return useQuery({
    queryKey: ["permission-config"],
    queryFn: () => api<PermissionConfig>("/api/permissions"),
  });
}

export function useSavePermissionConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Record<string, unknown>) =>
      api("/api/permissions/save", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permission-config"] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      publishLocalSync(["employees", "organizations"]);
    },
  });
}

export function useSaveEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Record<string, unknown>) =>
      api("/api/employees/save", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      publishLocalSync(["employees", "organizations", "approvals", "dashboard"]);
    },
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api("/api/employees/delete", {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      publishLocalSync(["employees", "organizations", "approvals", "dashboard"]);
    },
  });
}

export function useSaveOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Record<string, unknown>) =>
      api("/api/organizations/save", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      publishLocalSync(["organizations", "employees", "dashboard"]);
    },
  });
}

export function useDeleteOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api("/api/organizations/delete", {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      publishLocalSync(["organizations", "employees", "dashboard"]);
    },
  });
}

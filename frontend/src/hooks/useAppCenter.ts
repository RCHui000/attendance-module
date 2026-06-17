import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { publishLocalSync } from "@/hooks/useRealtime";
import type { AppCenterItem, SaveAppCenterItemInput } from "@/types/appCenter";

export function useAppCenterItems() {
  return useQuery({
    queryKey: ["app-center"],
    queryFn: () => api<AppCenterItem[]>("/api/apps"),
  });
}

export function useSaveAppCenterItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: SaveAppCenterItemInput) =>
      api("/api/apps/save", {
        method: "POST",
        body: JSON.stringify(item),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-center"] });
      publishLocalSync(["apps"]);
    },
  });
}

export function useDeleteAppCenterItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api("/api/apps/delete", {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-center"] });
      publishLocalSync(["apps"]);
    },
  });
}

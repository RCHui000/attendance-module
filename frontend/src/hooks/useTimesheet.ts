import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { publishLocalSync } from "@/hooks/useRealtime";
import type { Timesheet, SaveTimesheetPayload } from "@/types/timesheet";

export function useTimesheet(
  weekStart: string,
  options: { pauseRealtime?: boolean } = {},
) {
  return useQuery({
    queryKey: ["timesheet", weekStart],
    queryFn: () =>
      api<Timesheet>(`/api/timesheet?weekStart=${weekStart}`),
    enabled: !!weekStart,
    refetchInterval: options.pauseRealtime ? false : 15_000,
  });
}

export function useSaveTimesheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SaveTimesheetPayload) =>
      api<{ ok: boolean }>("/api/timesheet/save", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timesheet"] });
      publishLocalSync(["timesheet", "reports", "dashboard"]);
    },
  });
}

export function useSubmitTimesheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { timesheetId: number; action: string }) =>
      api("/api/timesheet/action", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timesheet"] });
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      publishLocalSync(["timesheet", "approvals", "reports", "dashboard"]);
    },
  });
}

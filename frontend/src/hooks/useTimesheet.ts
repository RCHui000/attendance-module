import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Timesheet, SaveTimesheetPayload } from "@/types/timesheet";

export function useTimesheet(weekStart: string) {
  return useQuery({
    queryKey: ["timesheet", weekStart],
    queryFn: () =>
      api<Timesheet>(`/api/timesheet?weekStart=${weekStart}`),
    enabled: !!weekStart,
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
    },
  });
}

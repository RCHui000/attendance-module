import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { publishLocalSync } from "@/hooks/useRealtime";
import { toast } from "sonner";
import type {
  ApprovalTemplate,
  ApprovalTasks,
  TimesheetDetail,
} from "@/types/approval";

type ReviewActionParams = {
  timesheetId: number;
  taskId?: number;
  action: "approve" | "reject" | "reopen";
  comment?: string;
};

type OvertimeActionParams = {
  id: number;
  status: "approved" | "rejected";
  comment?: string;
};

type ApprovalTaskRangeParams = {
  reviewStartDate?: string;
  reviewEndDate?: string;
};

function invalidateLater(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKeys: unknown[][],
  delayMs = 2500,
) {
  window.setTimeout(() => {
    queryKeys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
  }, delayMs);
}

export function useApprovalTasks(weekStart: string, range: ApprovalTaskRangeParams = {}) {
  const query = new URLSearchParams({ weekStart });
  if (range.reviewStartDate) query.set("reviewStartDate", range.reviewStartDate);
  if (range.reviewEndDate) query.set("reviewEndDate", range.reviewEndDate);

  return useQuery({
    queryKey: ["approvals", weekStart, range.reviewStartDate || "", range.reviewEndDate || ""],
    queryFn: () =>
      api<ApprovalTasks>(`/api/approvals/tasks?${query.toString()}`),
    enabled: !!weekStart,
    staleTime: 10_000,
    placeholderData: (previousData) => previousData,
    select: (data) => ({
      ...data,
      inProgress: data.inProgress || [],
    }),
  });
}

export function useTimesheetDetail(timesheetId: number | null) {
  return useQuery({
    queryKey: ["timesheet-detail", timesheetId],
    queryFn: () =>
      api<TimesheetDetail>(
        `/api/timesheet-detail?timesheetId=${timesheetId}`,
      ),
    enabled: timesheetId != null && timesheetId > 0,
    staleTime: 60_000,
  });
}

export function useReviewAction() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, ReviewActionParams>({
    mutationFn: (params) =>
      api("/api/timesheet/action", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["timesheet-detail", variables.timesheetId] });
      invalidateLater(queryClient, [["timesheet"], ["reports"], ["dashboard"]]);
      publishLocalSync(["timesheet", "approvals"]);
      toast.success("审批操作已提交");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "审批操作失败");
    },
  });
}

export function useOvertimeAction() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, OvertimeActionParams>({
    mutationFn: (params) =>
      api("/api/overtime/action", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      invalidateLater(queryClient, [["timesheet"], ["reports"], ["dashboard"]]);
      publishLocalSync(["timesheet", "approvals"]);
    },
  });
}

export function useApprovalTemplates() {
  return useQuery({
    queryKey: ["approval-templates"],
    queryFn: () => api<ApprovalTemplate[]>("/api/approval-templates"),
    staleTime: 10 * 60_000,
  });
}

export function useSaveApprovalTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (template: ApprovalTemplate) =>
      api("/api/approval-templates/save", {
        method: "POST",
        body: JSON.stringify(template),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-templates"] });
      publishLocalSync(["approvals"]);
    },
  });
}

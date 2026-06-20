import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { publishLocalSync } from "@/hooks/useRealtime";
import { toast } from "sonner";
import type {
  ApprovalTemplate,
  ApprovalTasks,
  TimesheetDetail,
} from "@/types/approval";

export function useApprovalTasks(weekStart: string) {
  return useQuery({
    queryKey: ["approvals", weekStart],
    queryFn: () =>
      api<ApprovalTasks>(`/api/approvals/tasks?weekStart=${weekStart}`),
    enabled: !!weekStart,
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
  });
}

export function useReviewAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      timesheetId: number;
      taskId?: number;
      action: "approve" | "reject" | "reopen";
      comment?: string;
    }) =>
      api("/api/timesheet/action", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["timesheet-detail"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      publishLocalSync(["timesheet", "approvals", "reports", "dashboard"]);
      toast.success("审批操作已提交");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "审批操作失败");
    },
  });
}

export function useOvertimeAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      id: number;
      status: "approved" | "rejected";
      comment?: string;
    }) =>
      api("/api/overtime/action", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      publishLocalSync(["timesheet", "approvals", "reports", "dashboard"]);
    },
  });
}

export function useApprovalTemplates() {
  return useQuery({
    queryKey: ["approval-templates"],
    queryFn: () => api<ApprovalTemplate[]>("/api/approval-templates"),
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

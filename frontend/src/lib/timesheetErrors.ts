import type { SaveTimesheetPayload } from "@/types/timesheet";

export type TimesheetErrorAction = "save" | "submit" | "withdraw";

const actionPrefix: Record<TimesheetErrorAction, string> = {
  save: "保存失败",
  submit: "提交失败",
  withdraw: "撤回失败",
};

function technicalMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const message = String(error || "").trim();
  return message || fallback;
}

function chineseTimesheetMessage(detail: string) {
  if (/project[_\s-]?id|projectId|project_id/i.test(detail)) {
    return "有工时记录缺少项目，请选择项目后再保存。";
  }
  if (/timesheet[_\s-]?id|timesheetId|timesheet_id/i.test(detail)) {
    return "系统没有找到当前周表，请刷新页面后重试。";
  }
  if (/permission|not authenticated|jwt|unauthorized|42501/i.test(detail)) {
    return "当前账号没有完成此操作的权限，请重新登录或联系管理员。";
  }
  if (/hours|work[_\s-]?date|entries|payload|invalid input|violates/i.test(detail)) {
    return "周表填写内容不完整或格式不正确，请检查项目、日期和工日后重试。";
  }
  return "系统暂时无法完成周表操作，请检查填写内容后重试。";
}

export function validateTimesheetPayload(payload: SaveTimesheetPayload) {
  const badEntryIndex = (payload.entries || []).findIndex(
    (entry) => Number(entry.hours || 0) > 0 && !Number(entry.projectId || 0),
  );
  if (badEntryIndex >= 0) {
    return `请先选择项目，再填写工日。\nTechnical detail: entries[${badEntryIndex}].projectId is required when hours > 0`;
  }
  return "";
}

export function formatTimesheetError(error: unknown, action: TimesheetErrorAction) {
  const detail = technicalMessage(error, actionPrefix[action]);
  const prefix = actionPrefix[action];
  const chineseMessage = chineseTimesheetMessage(detail);
  if (!detail || detail === prefix) return `${prefix}：${chineseMessage}`;
  return `${prefix}：${chineseMessage}\nTechnical detail: ${detail}`;
}

import { describe, expect, it } from "vitest";
import {
  formatTimesheetError,
  validateTimesheetPayload,
} from "@/lib/timesheetErrors";
import type { SaveTimesheetPayload } from "@/types/timesheet";

describe("timesheet error messages", () => {
  it("explains rows with hours but no project in Chinese", () => {
    const payload: SaveTimesheetPayload = {
      weekStart: "2026-06-08",
      remark: "",
      entries: [
        {
          projectId: 0,
          workDate: "2026-06-08",
          hours: 0.5,
          description: "",
        },
      ],
      overtime: [],
    };

    expect(validateTimesheetPayload(payload)).toBe(
      "请先选择项目，再填写工日。\nTechnical detail: entries[0].projectId is required when hours > 0",
    );
  });

  it("adds Chinese context to backend project_id errors", () => {
    const error = new Error('null value in column "project_id" violates not-null constraint');

    expect(formatTimesheetError(error, "save")).toBe(
      '保存失败：有工时记录缺少项目，请选择项目后再保存。\nTechnical detail: null value in column "project_id" violates not-null constraint',
    );
  });

  it("keeps unknown English details after a Chinese action prefix", () => {
    const error = new Error("Timesheet id is required");

    expect(formatTimesheetError(error, "submit")).toBe(
      "提交失败：系统没有找到当前周表，请刷新页面后重试。\nTechnical detail: Timesheet id is required",
    );
  });
});

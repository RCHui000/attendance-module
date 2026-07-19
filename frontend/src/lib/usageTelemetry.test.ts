import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decodeJwt: vi.fn(),
  rest: vi.fn(),
}));

vi.mock("./restClient", () => ({
  accessRank: vi.fn(() => 0),
  decodeJwt: mocks.decodeJwt,
  payload: vi.fn((options: RequestInit) => JSON.parse(String(options.body || "{}"))),
  rest: mocks.rest,
}));

vi.mock("./supabase", () => ({
  clearStoredToken: vi.fn(),
  getStoredToken: vi.fn(() => "test-token"),
}));

import { recordAppCenterOpen, recordDepartmentOwnerLogin } from "./api";

describe("usage telemetry", () => {
  beforeEach(() => {
    mocks.decodeJwt.mockReset();
    mocks.rest.mockReset();
    mocks.decodeJwt.mockReturnValue({ sub: "auth-user-1" });
  });

  it("records only the minimum app-open fields with a keepalive request", async () => {
    mocks.rest
      .mockResolvedValueOnce([{ id: 17, name: "测试主管", is_active: true }])
      .mockResolvedValueOnce(null);

    await recordAppCenterOpen({
      id: 9,
      app_key: "nas-files",
      name: "文件中心",
      is_internal: true,
    });

    expect(mocks.rest).toHaveBeenNthCalledWith(
      1,
      "/employees?select=id,name,is_active&auth_user_id=eq.auth-user-1&limit=1",
    );
    const [, request] = mocks.rest.mock.calls[1] as [string, RequestInit];
    expect(mocks.rest.mock.calls[1][0]).toBe("/usage_event_logs");
    expect(request).toMatchObject({
      method: "POST",
      headers: { Prefer: "return=minimal" },
      keepalive: true,
    });
    expect(JSON.parse(String(request.body))).toEqual({
      event_type: "app_center_open",
      actor_employee_id: 17,
      actor_name: "测试主管",
      app_center_item_id: 9,
      app_name: "文件中心",
      metadata: { app_key: "nas-files", is_internal: true },
    });
    expect(String(request.body)).not.toMatch(
      /phone|mobile|salary|contract|password|token|credential/i,
    );
  });

  it("records department-owner login without app details", async () => {
    mocks.rest
      .mockResolvedValueOnce([{ id: 17, name: "测试主管", is_active: true }])
      .mockResolvedValueOnce(null);

    await recordDepartmentOwnerLogin();

    const request = mocks.rest.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      event_type: "department_owner_login",
      actor_employee_id: 17,
      actor_name: "测试主管",
      app_center_item_id: null,
      app_name: "",
      metadata: {},
    });
  });

  it("never surfaces lookup or insert failures", async () => {
    mocks.rest.mockRejectedValue(new Error("telemetry unavailable"));

    await expect(recordDepartmentOwnerLogin()).resolves.toBeUndefined();
    await expect(
      recordAppCenterOpen({ id: 9, name: "文件中心" }),
    ).resolves.toBeUndefined();
  });
});

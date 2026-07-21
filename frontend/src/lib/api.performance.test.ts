import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { setStoredToken } from "./authToken";

function response(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function sessionToken(sub = "auth-user-1") {
  return `header.${btoa(JSON.stringify({ sub }))}.signature`;
}

describe("API navigation performance contracts", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("bootstraps identity without loading project or historical timesheet data", async () => {
    setStoredToken(sessionToken());
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/employees?select=id,name,is_active")) {
        return response([{ id: 7, name: "测试员工", is_active: true }]);
      }
      if (url.includes("/employee_profiles?select=org_id,employment_status")) {
        return response([{ org_id: 3, employment_status: "active" }]);
      }
      if (url.includes("/user_roles?select=role")) return response([{ role: "employee" }]);
      if (url.includes("/organizations?select=org_name")) return response([{ org_name: "设计咨询部" }]);
      if (url.includes("/role_permissions?select=resource_key,access_level")) return response([]);
      if (url.includes("/role_permissions?select=resource_key,sidebar_order")) return response([]);
      if (url.includes("/permission_resources?select=resource_key,sort_order")) return response([]);
      return response([]);
    });

    const data = await api<{ currentUser: { id: number } | null; projects: unknown[] }>("/api/bootstrap");
    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));

    expect(data.currentUser?.id).toBe(7);
    expect(data.projects).toEqual([]);
    expect(requestedUrls.some((url) => url.includes("/projects?"))).toBe(false);
    expect(requestedUrls.some((url) => url.includes("/timesheet_entries?"))).toBe(false);
    expect(requestedUrls.some((url) => url.includes("/timesheets?"))).toBe(false);
  });

  it("loads the timesheet project picker through one brief project request", async () => {
    fetchMock.mockImplementation(() =>
      response([{ id: 11, code: "PM26001", name: "测试项目", work_kind: "project", status: "active" }]),
    );

    const projects = await api<Array<{ id: number }>>("/api/projects?view=brief");
    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));

    expect(projects).toHaveLength(1);
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("/projects?select=id,code,name,work_kind,business_type,status");
  });
});

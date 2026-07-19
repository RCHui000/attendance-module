import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  recordDepartmentOwnerLogin: vi.fn(),
  setCurrentWeek: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: mocks.api,
  recordDepartmentOwnerLogin: mocks.recordDepartmentOwnerLogin,
}));

vi.mock("@/lib/supabase", () => ({
  clearStoredToken: vi.fn(),
  signInWithLogin: vi.fn(),
  signOutFromSupabase: vi.fn(),
}));

vi.mock("@/stores/appStore", () => ({
  useAppStore: {
    getState: () => ({ setCurrentWeek: mocks.setCurrentWeek }),
  },
}));

import { useAuthStore } from "./authStore";

const bootstrap = {
  currentUser: {
    id: 17,
    name: "测试主管",
    role: "manager",
    permissions: {},
    sidebarOrder: {},
  },
  permissions: {},
  sidebarOrder: {},
  currentWeek: "2026-07-13",
};

describe("login usage event handoff", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.api.mockReset().mockResolvedValue(bootstrap);
    mocks.recordDepartmentOwnerLogin.mockReset().mockResolvedValue(undefined);
    mocks.setCurrentWeek.mockReset();
  });

  it("records once after a successful login reload", async () => {
    sessionStorage.setItem("psa_pending_login_usage_event", "1");

    await useAuthStore.getState().checkSession();
    await Promise.resolve();

    expect(mocks.recordDepartmentOwnerLogin).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("psa_pending_login_usage_event")).toBeNull();
  });

  it("does not count an ordinary session refresh as another login", async () => {
    await useAuthStore.getState().checkSession();
    await Promise.resolve();

    expect(mocks.recordDepartmentOwnerLogin).not.toHaveBeenCalled();
  });
});

import { create } from "zustand";
import { api, recordDepartmentOwnerLogin } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import { clearStoredToken, signInWithLogin, signOutFromSupabase } from "@/lib/supabase";
import type { CurrentUser, BootstrapData, PermissionAccess, PermissionMap, SidebarOrderMap } from "@/types/auth";

interface AuthState {
  user: CurrentUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  canReview: boolean;
  permissions: PermissionMap;
  sidebarOrder: SidebarOrderMap;
  setSidebarOrder: (sidebarOrder: SidebarOrderMap) => void;
  canAccess: (resourceKey: string, minAccess?: PermissionAccess) => boolean;
  isLoading: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  changePassword: (
    login: string,
    oldPassword: string,
    newPassword: string,
  ) => Promise<void>;
}

const PENDING_LOGIN_USAGE_EVENT = "psa_pending_login_usage_event";

function markLoginUsageEvent(): void {
  try {
    sessionStorage.setItem(PENDING_LOGIN_USAGE_EVENT, "1");
  } catch {
    // Session storage is optional; login must remain unaffected when unavailable.
  }
}

function consumeLoginUsageEvent(): boolean {
  try {
    if (sessionStorage.getItem(PENDING_LOGIN_USAGE_EVENT) !== "1") return false;
    sessionStorage.removeItem(PENDING_LOGIN_USAGE_EVENT);
    return true;
  } catch {
    return false;
  }
}

function computePermissions(user: CurrentUser | null) {
  if (!user)
    return { isAdmin: false, canReview: false };
  const isAdmin = user.role === "admin";
  const canReview = isAdmin || accessRank(user.permissions?.review) >= accessRank("read");
  return { isAdmin, canReview };
}

function accessRank(access: PermissionAccess | undefined) {
  if (access === "write") return 2;
  if (access === "read") return 1;
  return 0;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  canReview: false,
  permissions: {},
  sidebarOrder: {},
  setSidebarOrder: (sidebarOrder) =>
    set((state) => ({
      sidebarOrder,
      user: state.user ? { ...state.user, sidebarOrder } : state.user,
    })),
  isLoading: true,
  canAccess: (resourceKey: string, minAccess: PermissionAccess = "read"): boolean => {
    const state = get();
    if (state.isAdmin) return true;
    return accessRank(state.permissions[resourceKey]) >= accessRank(minAccess);
  },

  login: async (login: string, password: string) => {
    await signInWithLogin(login, password);
    markLoginUsageEvent();
    window.location.reload();
  },

  logout: async () => {
    try {
      await signOutFromSupabase();
      await api("/api/logout", { method: "POST" });
    } catch {
      // Local logout should proceed even if the server session is already gone.
    }
    clearStoredToken();
    window.location.reload();
  },

  checkSession: async () => {
    try {
      const data = await api<BootstrapData>("/api/bootstrap");
      const sidebarOrder = data.sidebarOrder || data.currentUser?.sidebarOrder || {};
      const user = data.currentUser ? { ...data.currentUser, permissions: data.permissions || {}, sidebarOrder } : null;
      const { isAdmin, canReview } = computePermissions(user);
      set({ user, isAuthenticated: !!user, isAdmin, canReview, permissions: data.permissions || {}, sidebarOrder, isLoading: false });

      if (user && consumeLoginUsageEvent()) {
        void recordDepartmentOwnerLogin();
      }

      // Set the correct Monday from the server
      if (data.currentWeek) {
        useAppStore.getState().setCurrentWeek(data.currentWeek);
      }
    } catch {
      set({ user: null, isAuthenticated: false, isAdmin: false, canReview: false, permissions: {}, sidebarOrder: {}, isLoading: false });
    }
  },

  changePassword: async (login: string, oldPassword: string, newPassword: string) => {
    await api("/api/password/change", {
      method: "POST",
      body: JSON.stringify({ login, oldPassword, newPassword }),
    });
  },
}));

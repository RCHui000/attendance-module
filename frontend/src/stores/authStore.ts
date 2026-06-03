import { create } from "zustand";
import { api } from "@/lib/api";
import { SUPERUSER_NAMES, SUPERUSER_IDS } from "@/lib/constants";
import { useAppStore } from "@/stores/appStore";
import { setStoredToken, clearStoredToken } from "@/lib/supabase";
import type { CurrentUser, BootstrapData } from "@/types/auth";

interface AuthState {
  user: CurrentUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  canReview: boolean;
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

function computePermissions(user: CurrentUser | null) {
  if (!user)
    return { isAdmin: false, canReview: false };
  const isAdmin =
    user.role === "admin" ||
    SUPERUSER_NAMES.has(user.name) ||
    SUPERUSER_IDS.has(user.id);
  const canReview =
    isAdmin || user.role === "manager";
  return { isAdmin, canReview };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  canReview: false,
  isLoading: true,

  login: async (login: string, password: string) => {
    const data = await api<{ ok: boolean; token: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ login, password }),
    });
    if (data.token) {
      setStoredToken(data.token);
    }
    window.location.reload();
  },

  logout: async () => {
    try {
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
      const user = data.currentUser;
      const { isAdmin, canReview } = computePermissions(user);
      set({ user, isAuthenticated: !!user, isAdmin, canReview, isLoading: false });

      // Set the correct Monday from the server
      if (data.currentWeek) {
        useAppStore.getState().setCurrentWeek(data.currentWeek);
      }
    } catch {
      set({ user: null, isAuthenticated: false, isAdmin: false, canReview: false, isLoading: false });
    }
  },

  changePassword: async (login: string, oldPassword: string, newPassword: string) => {
    await api("/api/password/change", {
      method: "POST",
      body: JSON.stringify({ login, oldPassword, newPassword }),
    });
  },
}));

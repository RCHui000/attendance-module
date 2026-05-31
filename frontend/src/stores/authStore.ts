import { create } from "zustand";
import { api } from "@/lib/api";
import { SUPERUSER_NAMES, SUPERUSER_IDS } from "@/lib/constants";
import { mondayOfWeek } from "@/utils/dates";
import { useAppStore } from "@/stores/appStore";
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
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ login, password }),
    });
    // Reload the page so the cookie is picked up
    window.location.reload();
  },

  logout: async () => {
    await api("/api/logout", { method: "POST" });
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

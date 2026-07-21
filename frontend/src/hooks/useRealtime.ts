import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getStoredToken } from "@/lib/authToken";
import type { RealtimeChannel, RealtimeClient } from "@supabase/realtime-js";

const CHANNEL_NAME = "psa-supabase-sync";
type SyncModule =
  "timesheet"
  | "approvals"
  | "reports"
  | "dashboard"
  | "employees"
  | "organizations"
  | "projects"
  | "apps";

const REALTIME_URL =
  import.meta.env.VITE_SUPABASE_REALTIME_URL ||
  (() => {
    const { protocol, host } = window.location;
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${host}/realtime/socket`;
  })();

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

const TABLE_MODULES: Record<string, SyncModule[]> = {
  timesheets: ["timesheet", "approvals", "reports", "dashboard"],
  timesheet_entries: ["timesheet", "reports", "dashboard"],
  overtime_entries: ["timesheet", "approvals", "reports", "dashboard"],
  approval_nodes: ["timesheet", "approvals"],
  approval_node_assignees: ["timesheet", "approvals"],
  approval_events: ["approvals"],
  approval_instances: ["approvals"],
  timesheet_project_reviews: ["timesheet", "approvals"],
  projects: ["projects"],
  project_roles: ["projects", "approvals"],
  project_department_owners: ["projects", "approvals"],
  employees: ["employees", "organizations", "approvals"],
  employee_profiles: ["employees", "organizations", "approvals"],
  organizations: ["organizations", "employees"],
  user_roles: ["employees", "organizations", "approvals"],
  app_center_items: ["apps"],
};

function invalidateModules(
  queryClient: ReturnType<typeof useQueryClient>,
  modules: string[],
): void {
  if (modules.includes("timesheet")) queryClient.invalidateQueries({ queryKey: ["timesheet"] });
  if (modules.includes("approvals")) queryClient.invalidateQueries({ queryKey: ["approvals"] });
  if (modules.includes("reports")) queryClient.invalidateQueries({ queryKey: ["reports"] });
  if (modules.includes("dashboard")) queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  if (modules.includes("employees")) queryClient.invalidateQueries({ queryKey: ["employees"] });
  if (modules.includes("organizations")) queryClient.invalidateQueries({ queryKey: ["organizations"] });
  if (modules.includes("projects")) queryClient.invalidateQueries({ queryKey: ["projects"] });
  if (modules.includes("projects")) queryClient.invalidateQueries({ queryKey: ["project-base"] });
  if (modules.includes("projects")) queryClient.invalidateQueries({ queryKey: ["all-projects"] });
  if (modules.includes("apps")) queryClient.invalidateQueries({ queryKey: ["app-center"] });
}

export function publishLocalSync(modules: string[]): void {
  if (!("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ modules });
  channel.close();
}

export function useRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = getStoredToken();
    const apiKey = token || ANON_KEY;
    const localChannel =
      "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;

    localChannel?.addEventListener("message", (event) => {
      const modules = Array.isArray(event.data?.modules) ? event.data.modules : [];
      invalidateModules(queryClient, modules);
    });

    if (!token || !apiKey) {
      return () => localChannel?.close();
    }

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshModules = new Set<SyncModule>();
    const scheduleRefresh = (modules: SyncModule[]) => {
      modules.forEach((module) => refreshModules.add(module));
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        invalidateModules(queryClient, Array.from(refreshModules));
        refreshModules.clear();
        refreshTimer = null;
      }, 250);
    };

    let cancelled = false;
    let realtime: RealtimeClient | null = null;
    let channel: RealtimeChannel | null = null;

    const connect = async () => {
      const { RealtimeClient: Client } = await import("@supabase/realtime-js");
      if (cancelled) return;

      realtime = new Client(REALTIME_URL, {
        params: { apikey: apiKey },
        accessToken: async () => getStoredToken(),
        heartbeatIntervalMs: 20_000,
        reconnectAfterMs: (tries: number) => Math.min(tries * 1_000, 10_000),
      });

      channel = realtime.channel("psa-db-changes");
      Object.entries(TABLE_MODULES).forEach(([table, modules]) => {
        channel?.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          () => scheduleRefresh(modules),
        );
      });
      channel.subscribe();
      realtime.connect();
    };

    void connect();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      localChannel?.close();
      if (channel) realtime?.removeChannel(channel);
      realtime?.disconnect();
    };
  }, [queryClient]);
}

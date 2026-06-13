import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RealtimeClient } from "@supabase/realtime-js";
import { getStoredToken } from "@/lib/supabase";

const CHANNEL_NAME = "psa-supabase-sync";
type SyncModule =
  "timesheet"
  | "approvals"
  | "reports"
  | "dashboard"
  | "employees"
  | "organizations"
  | "projects";

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
  approval_nodes: ["timesheet", "approvals", "reports", "dashboard"],
  approval_node_assignees: ["timesheet", "approvals", "reports", "dashboard"],
  approval_events: ["approvals", "dashboard"],
  approval_instances: ["approvals", "dashboard"],
  timesheet_project_reviews: ["timesheet", "approvals", "reports", "dashboard"],
  projects: ["projects", "reports", "dashboard"],
  project_department_owners: ["projects", "timesheet", "approvals", "reports", "dashboard"],
  employees: ["employees", "organizations", "approvals", "dashboard"],
  employee_profiles: ["employees", "organizations", "approvals", "dashboard"],
  organizations: ["organizations", "employees", "dashboard"],
  user_roles: ["employees", "organizations", "approvals"],
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

    const realtime = new RealtimeClient(REALTIME_URL, {
      params: { apikey: apiKey },
      accessToken: async () => getStoredToken(),
      heartbeatIntervalMs: 20_000,
      reconnectAfterMs: (tries: number) => Math.min(tries * 1_000, 10_000),
    });

    const channel = realtime.channel("psa-db-changes");
    Object.entries(TABLE_MODULES).forEach(([table, modules]) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => scheduleRefresh(modules),
      );
    });
    channel.subscribe();
    realtime.connect();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      localChannel?.close();
      realtime.removeChannel(channel);
      realtime.disconnect();
    };
  }, [queryClient]);
}

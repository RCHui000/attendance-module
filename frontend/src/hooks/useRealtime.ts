import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/authStore";
import { getClientId } from "@/lib/api";
import { toast } from "sonner";

/**
 * Module → TanStack Query key mapping.
 * When a sync message arrives with a list of modules,
 * we invalidate the corresponding query keys.
 */
const MODULE_TO_QUERY_KEYS: Record<string, string[][]> = {
  timesheet: [["timesheet"]],
  approvals: [["approvals"], ["reports"]],
  reports: [["reports"], ["dashboard"]],
  dashboard: [["dashboard"], ["reports"]],
  employees: [["employees"]],
  organizations: [["organizations"], ["employees"]],
};

/**
 * Re-reconnect interval in milliseconds.
 * Matches the original app.js 3-second retry.
 */
const RECONNECT_DELAY = 3000;

/**
 * Hook that manages the WebSocket connection to /ws/sync.
 * On receiving a `sync` message from a different client,
 * it automatically invalidates the corresponding TanStack
 * Query cache keys so data re-fetches in the background.
 *
 * The sourceClientId check is handled by the API client,
 * but the WebSocket payload also includes a sourceClientId
 * for the hook to skip self-originated syncs.
 */
export function useRealtime() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!user) return;
    const clientId = getClientId();
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/ws/sync?clientId=${encodeURIComponent(clientId)}`;

    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.addEventListener("open", () => {
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type !== "sync") return;
        if (payload.sourceClientId === clientId) return;
        handleSyncModules(payload.modules || []);
      } catch {
        // Ignore malformed messages
      }
    });

    socket.addEventListener("close", () => {
      wsRef.current = null;
      if (!user) return;
      retryRef.current = setTimeout(connect, RECONNECT_DELAY);
    });

    socket.addEventListener("error", () => {
      // The close event will fire after error; handle reconnection there.
    });
  }, [user]);

  const handleSyncModules = useCallback(
    (modules: string[]) => {
      const keysToInvalidate = new Set<string>();
      for (const mod of modules) {
        const keys = MODULE_TO_QUERY_KEYS[mod];
        if (keys) {
          for (const key of keys) {
            keysToInvalidate.add(JSON.stringify(key));
          }
        }
      }

      // Invalidate all affected query keys
      for (const keyStr of keysToInvalidate) {
        const key = JSON.parse(keyStr);
        queryClient.invalidateQueries({ queryKey: key });
      }

      // Notify the user about the sync
      const moduleNames = modules
        .map((m) => {
          const map: Record<string, string> = {
            timesheet: "周表",
            approvals: "审批",
            reports: "报表",
            dashboard: "看板",
            employees: "员工",
            organizations: "组织",
          };
          return map[m] || m;
        })
        .join("、");

      if (moduleNames) {
        toast(`数据已同步：${moduleNames}`, {
          description: "其他设备更新了数据，已自动刷新",
        });
      }
    },
    [queryClient],
  );

  useEffect(() => {
    connect();

    return () => {
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);
}

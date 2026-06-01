import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const CHANNEL_NAME = "psa-supabase-sync";

export function publishLocalSync(modules: string[]): void {
  if (!("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ modules });
  channel.close();
}

export function useRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      const modules = Array.isArray(event.data?.modules) ? event.data.modules : [];
      if (modules.includes("timesheet")) queryClient.invalidateQueries({ queryKey: ["timesheet"] });
      if (modules.includes("approvals")) queryClient.invalidateQueries({ queryKey: ["approvals"] });
      if (modules.includes("reports")) queryClient.invalidateQueries({ queryKey: ["reports"] });
      if (modules.includes("dashboard")) queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (modules.includes("employees")) queryClient.invalidateQueries({ queryKey: ["employees"] });
      if (modules.includes("organizations")) queryClient.invalidateQueries({ queryKey: ["organizations"] });
    };
    return () => channel.close();
  }, [queryClient]);
}

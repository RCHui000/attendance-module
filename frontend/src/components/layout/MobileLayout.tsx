import type { ReactNode } from "react";
import { MobileBottomNav } from "./MobileBottomNav";
import { Topbar } from "./Topbar";

export function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <main className="min-h-dvh px-3 pb-[calc(88px+env(safe-area-inset-bottom))] pt-3">
        <Topbar mobile />
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
}

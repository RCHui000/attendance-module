import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function DesktopLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 p-[30px_36px] max-[1179px]:p-5 max-[900px]:p-4">
        <Topbar />
        {children}
      </main>
    </div>
  );
}


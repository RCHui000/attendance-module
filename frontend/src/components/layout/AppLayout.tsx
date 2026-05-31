import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex max-[900px]:flex-col min-h-screen">
      <Sidebar />
      <main className="flex-1 p-[30px_36px] max-[900px]:p-4">
        <Topbar />
        {children}
      </main>
    </div>
  );
}

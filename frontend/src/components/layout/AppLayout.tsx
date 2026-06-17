import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { DesktopLayout } from "./DesktopLayout";
import { MobileLayout } from "./MobileLayout";

export function AppLayout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();

  return isMobile ? (
    <MobileLayout>{children}</MobileLayout>
  ) : (
    <DesktopLayout>{children}</DesktopLayout>
  );
}

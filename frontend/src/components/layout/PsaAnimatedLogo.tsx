import { useState } from "react";

import { cn } from "@/lib/utils";

type PsaAnimatedLogoProps = {
  className?: string;
};

export function PsaAnimatedLogo({ className }: PsaAnimatedLogoProps) {
  const [animationKey, setAnimationKey] = useState(0);

  return (
    <div
      className={cn(
        "psa-animated-logo relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-neutral-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] select-none",
        className,
      )}
      aria-label="PSA项目成本管理系统"
      onMouseEnter={() => setAnimationKey((key) => key + 1)}
      role="img"
    >
      <div key={animationKey} className="absolute inset-0">
        <svg className="psa-logo-person absolute inset-0 size-full" viewBox="0 0 36 36" aria-hidden="true">
          <g className="psa-logo-person-look">
            <circle cx="18" cy="12.2" r="4.8" fill="currentColor" />
            <path
              d="M12.3 27.3c.9-5 2.8-8 5.7-8s4.8 3 5.7 8"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="4.2"
            />
            <path
              d="M13.4 18.4 10.2 23M22.6 18.4 25.8 23"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.2"
            />
            <circle className="psa-logo-eye" cx="16.4" cy="11.6" r="0.9" fill="#111827" />
            <circle className="psa-logo-eye" cx="19.6" cy="11.6" r="0.9" fill="#111827" />
          </g>
        </svg>

        <span className="psa-logo-word absolute inset-0 flex items-center justify-center text-[0.95rem] leading-none font-black tracking-[0.01em] text-white">
          PSA
        </span>
      </div>
    </div>
  );
}

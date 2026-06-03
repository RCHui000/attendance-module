import { APP_NAME, APP_TAGLINE, APP_VERSION } from "@/lib/constants";

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-10 items-center justify-center rounded-lg bg-sidebar-bg text-white text-lg font-bold select-none">
        PSA
      </div>
      <div>
        <strong className="block text-sm text-foreground leading-tight">
          {APP_NAME} {APP_VERSION}
        </strong>
        <span className="text-xs text-muted-foreground">
          {APP_TAGLINE}
        </span>
      </div>
    </div>
  );
}

import { APP_NAME, APP_TAGLINE, APP_VERSION } from "@/lib/constants";
import { PsaAnimatedLogo } from "./PsaAnimatedLogo";

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <PsaAnimatedLogo className="size-10 rounded-lg" />
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

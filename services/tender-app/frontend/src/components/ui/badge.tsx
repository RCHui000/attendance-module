import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/0.18)] focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[#111827] text-white shadow-sm",
        secondary: "border-transparent bg-[#f2f4f7] text-[#344054]",
        destructive: "border-transparent bg-red-100 text-red-700",
        outline: "border-[#e4e7ec] text-[#667085]",
        warning: "border-transparent bg-amber-50 text-amber-700",
        info: "border-transparent bg-blue-50 text-blue-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge }

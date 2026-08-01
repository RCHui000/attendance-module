import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type PillSliderOption<T extends string | number> = {
  value: T
  label: ReactNode
}

type PillSliderProps<T extends string | number> = {
  options: PillSliderOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  buttonClassName?: string
}

export function PillSlider<T extends string | number>({
  options,
  value,
  onChange,
  className,
  buttonClassName,
}: PillSliderProps<T>) {
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const itemWidth = `${100 / Math.max(options.length, 1)}%`

  return (
    <div
      className={cn(
        "relative inline-grid h-10 overflow-hidden rounded-full border border-[#d9dee8] bg-white p-1 shadow-[0_2px_8px_rgba(16,24,40,0.10)]",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span className="pointer-events-none absolute inset-1 overflow-hidden rounded-full">
        <span
          className="absolute left-0 top-0 h-full rounded-full bg-[#101318] shadow-[0_8px_18px_rgba(16,19,24,0.22)] transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ width: itemWidth, transform: `translateX(${activeIndex * 100}%)` }}
        />
      </span>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "relative z-10 h-8 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#101318]/20",
              active ? "text-white" : "text-[#475467] hover:text-[#101318]",
              buttonClassName,
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

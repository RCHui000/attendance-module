import { cn } from "@/lib/utils";

export const departmentColorOptions = [
  { token: "", label: "无颜色", swatchClassName: "border-border bg-card" },
  { token: "slate", label: "灰蓝", swatchClassName: "border-slate-200 bg-slate-100" },
  { token: "blue", label: "雾蓝", swatchClassName: "border-blue-200 bg-blue-50" },
  { token: "cyan", label: "浅青", swatchClassName: "border-cyan-200 bg-cyan-50" },
  { token: "teal", label: "薄荷", swatchClassName: "border-teal-200 bg-teal-50" },
  { token: "green", label: "青绿", swatchClassName: "border-emerald-200 bg-emerald-50" },
  { token: "amber", label: "米黄", swatchClassName: "border-amber-200 bg-amber-50" },
  { token: "rose", label: "浅粉", swatchClassName: "border-rose-200 bg-rose-50" },
] as const;

const departmentColorClassMap: Record<string, string> = {
  slate: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200",
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200",
  teal: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-200",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  rose: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200",
};

export function departmentColorClass(token?: string | null) {
  return token ? departmentColorClassMap[token] || "" : "";
}

export function DepartmentChip({
  department,
  colorToken,
  className,
}: {
  department?: string | null;
  colorToken?: string | null;
  className?: string;
}) {
  const label = department || "—";
  const colorClass = departmentColorClass(colorToken);

  if (!colorClass) {
    return <span className={className}>{label}</span>;
  }

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-5",
        colorClass,
        className,
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

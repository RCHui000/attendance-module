export const departmentColorOptions = [
  { token: "", label: "无色", swatchClassName: "border-border bg-card" },
  { token: "slate", label: "冷灰", swatchClassName: "border-slate-200 bg-slate-100" },
  { token: "blue", label: "雾蓝", swatchClassName: "border-sky-200 bg-sky-50" },
  { token: "cyan", label: "靛蓝", swatchClassName: "border-indigo-200 bg-indigo-50" },
  { token: "teal", label: "鼠尾草", swatchClassName: "border-lime-200 bg-lime-50" },
  { token: "green", label: "淡紫", swatchClassName: "border-violet-200 bg-violet-50" },
  { token: "amber", label: "米黄", swatchClassName: "border-amber-200 bg-amber-50" },
  { token: "rose", label: "珊瑚", swatchClassName: "border-rose-200 bg-rose-50" },
] as const;

const departmentColorClassMap: Record<string, string> = {
  slate: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200",
  blue: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  cyan: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200",
  teal: "border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-800 dark:bg-lime-950/50 dark:text-lime-200",
  green: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
  amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  rose: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200",
};

export function departmentColorClass(token?: string | null) {
  return token ? departmentColorClassMap[token] || "" : "";
}

export function departmentColorLabel(token?: string | null) {
  return departmentColorOptions.find((option) => option.token === (token || ""))?.label || "无色";
}

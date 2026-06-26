export const departmentColorOptions = [
  { token: "", label: "无色", swatchClassName: "border-border bg-card text-foreground" },
  { token: "slate", label: "冷灰", swatchClassName: "border-slate-200 bg-slate-50 text-slate-700" },
  { token: "blue", label: "雾蓝", swatchClassName: "border-blue-200 bg-blue-50 text-blue-700" },
  { token: "cyan", label: "靛蓝", swatchClassName: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  { token: "teal", label: "鼠尾草", swatchClassName: "border-teal-200 bg-teal-50 text-teal-700" },
  { token: "green", label: "淡紫", swatchClassName: "border-violet-200 bg-violet-50 text-violet-700" },
  { token: "amber", label: "米黄", swatchClassName: "border-amber-200 bg-amber-50 text-amber-700" },
  { token: "rose", label: "珊瑚", swatchClassName: "border-rose-200 bg-rose-50 text-rose-700" },
] as const;

const departmentColorClassMap: Record<string, string> = {
  slate: "border-slate-200 bg-slate-50 text-foreground dark:border-slate-600/70 dark:bg-slate-800/70 dark:text-slate-100",
  blue: "border-blue-200 bg-blue-50 text-foreground dark:border-blue-500/50 dark:bg-blue-500/15 dark:text-slate-100",
  cyan: "border-indigo-200 bg-indigo-50 text-foreground dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-slate-100",
  teal: "border-teal-200 bg-teal-50 text-foreground dark:border-teal-500/50 dark:bg-teal-500/15 dark:text-slate-100",
  green: "border-violet-200 bg-violet-50 text-foreground dark:border-violet-500/50 dark:bg-violet-500/15 dark:text-slate-100",
  amber: "border-amber-200 bg-amber-50 text-foreground dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-slate-100",
  rose: "border-rose-200 bg-rose-50 text-foreground dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-slate-100",
};

const departmentSwatchClassMap: Record<string, string> = {
  slate: "border-slate-300 bg-slate-300 dark:border-slate-500 dark:bg-slate-400",
  blue: "border-blue-300 bg-blue-300 dark:border-blue-400 dark:bg-blue-300",
  cyan: "border-indigo-300 bg-indigo-300 dark:border-indigo-400 dark:bg-indigo-300",
  teal: "border-teal-300 bg-teal-300 dark:border-teal-400 dark:bg-teal-300",
  green: "border-violet-300 bg-violet-300 dark:border-violet-400 dark:bg-violet-300",
  amber: "border-amber-300 bg-amber-300 dark:border-amber-400 dark:bg-amber-300",
  rose: "border-rose-300 bg-rose-300 dark:border-rose-400 dark:bg-rose-300",
};

export function departmentColorClass(token?: string | null) {
  return token ? departmentColorClassMap[token] || "" : "";
}

export function departmentSwatchClass(token?: string | null) {
  return token ? departmentSwatchClassMap[token] || "" : "";
}

export function departmentColorLabel(token?: string | null) {
  return departmentColorOptions.find((option) => option.token === (token || ""))?.label || "无色";
}

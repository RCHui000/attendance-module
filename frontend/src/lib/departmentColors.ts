export const departmentColorOptions = [
  { token: "", label: "无色", swatchClassName: "border-border bg-card text-foreground" },
  { token: "slate", label: "冷灰", swatchClassName: "border-slate-300 bg-slate-100 text-slate-700" },
  { token: "blue", label: "雾蓝", swatchClassName: "border-sky-300 bg-sky-100 text-sky-800" },
  { token: "cyan", label: "靛蓝", swatchClassName: "border-indigo-300 bg-indigo-100 text-indigo-800" },
  { token: "teal", label: "鼠尾草", swatchClassName: "border-emerald-300 bg-emerald-100 text-emerald-800" },
  { token: "green", label: "淡紫", swatchClassName: "border-violet-300 bg-violet-100 text-violet-800" },
  { token: "amber", label: "米黄", swatchClassName: "border-amber-300 bg-amber-100 text-amber-800" },
  { token: "rose", label: "珊瑚", swatchClassName: "border-rose-300 bg-rose-100 text-rose-800" },
] as const;

const departmentColorClassMap: Record<string, string> = {
  slate: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
  blue: "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-600 dark:bg-sky-900 dark:text-sky-100",
  cyan: "border-indigo-300 bg-indigo-100 text-indigo-800 dark:border-indigo-600 dark:bg-indigo-900 dark:text-indigo-100",
  teal: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-600 dark:bg-emerald-900 dark:text-emerald-100",
  green: "border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-600 dark:bg-violet-900 dark:text-violet-100",
  amber: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-600 dark:bg-amber-900 dark:text-amber-100",
  rose: "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-600 dark:bg-rose-900 dark:text-rose-100",
};

const departmentSwatchClassMap: Record<string, string> = {
  slate: "border-slate-300 bg-slate-300 dark:border-slate-500 dark:bg-slate-500",
  blue: "border-sky-300 bg-sky-300 dark:border-sky-500 dark:bg-sky-500",
  cyan: "border-indigo-300 bg-indigo-300 dark:border-indigo-500 dark:bg-indigo-500",
  teal: "border-emerald-300 bg-emerald-300 dark:border-emerald-500 dark:bg-emerald-500",
  green: "border-violet-300 bg-violet-300 dark:border-violet-500 dark:bg-violet-500",
  amber: "border-amber-300 bg-amber-300 dark:border-amber-500 dark:bg-amber-500",
  rose: "border-rose-300 bg-rose-300 dark:border-rose-500 dark:bg-rose-500",
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

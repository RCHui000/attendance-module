export const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export const APP_NAME = "PSA项目成本管理系统";
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || "V0.12.7";
export const APP_TAGLINE = "项目成本、人力投入、组织薪酬";

export const holidayInfo: Record<string, { type: "rest" | "work"; name: string }> = {
  "2026-01-01": { type: "rest", name: "元旦" },
  "2026-01-02": { type: "rest", name: "元旦" },
  "2026-01-03": { type: "rest", name: "元旦" },
  "2026-01-04": { type: "work", name: "调休上班" },
  "2026-02-14": { type: "work", name: "调休上班" },
  "2026-02-15": { type: "rest", name: "春节" },
  "2026-02-16": { type: "rest", name: "春节" },
  "2026-02-17": { type: "rest", name: "春节" },
  "2026-02-18": { type: "rest", name: "春节" },
  "2026-02-19": { type: "rest", name: "春节" },
  "2026-02-20": { type: "rest", name: "春节" },
  "2026-02-21": { type: "rest", name: "春节" },
  "2026-02-22": { type: "rest", name: "春节" },
  "2026-02-23": { type: "rest", name: "春节" },
  "2026-02-28": { type: "work", name: "调休上班" },
  "2026-04-04": { type: "rest", name: "清明" },
  "2026-04-05": { type: "rest", name: "清明" },
  "2026-04-06": { type: "rest", name: "清明" },
  "2026-05-01": { type: "rest", name: "劳动节" },
  "2026-05-02": { type: "rest", name: "劳动节" },
  "2026-05-03": { type: "rest", name: "劳动节" },
  "2026-05-04": { type: "rest", name: "劳动节" },
  "2026-05-05": { type: "rest", name: "劳动节" },
  "2026-05-09": { type: "work", name: "调休上班" },
  "2026-06-19": { type: "rest", name: "端午" },
  "2026-06-20": { type: "rest", name: "端午" },
  "2026-06-21": { type: "rest", name: "端午" },
  "2026-09-20": { type: "work", name: "调休上班" },
  "2026-09-25": { type: "rest", name: "中秋" },
  "2026-09-26": { type: "rest", name: "中秋" },
  "2026-09-27": { type: "rest", name: "中秋" },
  "2026-10-01": { type: "rest", name: "国庆" },
  "2026-10-02": { type: "rest", name: "国庆" },
  "2026-10-03": { type: "rest", name: "国庆" },
  "2026-10-04": { type: "rest", name: "国庆" },
  "2026-10-05": { type: "rest", name: "国庆" },
  "2026-10-06": { type: "rest", name: "国庆" },
  "2026-10-07": { type: "rest", name: "国庆" },
  "2026-10-10": { type: "work", name: "调休上班" },
};

export const statusText: Record<string, string> = {
  draft: "草稿",
  submitted: "已提交",
  approved: "已通过",
  rejected: "已退回",
  locked: "已锁定",
  summarized: "已汇总",
};

export const roleText: Record<string, string> = {
  employee: "员工",
  manager: "主管",
  admin: "管理员",
};

export const SUPERUSER_NAMES = new Set(["admin", "鞠松松"]);
export const SUPERUSER_IDS = new Set([18]);

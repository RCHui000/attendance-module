import {
  Calendar,
  CalendarX2,
  ClipboardCheck,
  FolderKanban,
  Grid3X3,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  id: string;
  order: number;
  view: string;
  resource: string;
  label: string;
  mobileLabel?: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "dashboard", order: 1, view: "dashboard", resource: "dashboard", label: "数据看板", mobileLabel: "看板", icon: LayoutDashboard },
  { id: "review", order: 2, view: "review", resource: "review", label: "审批中心", mobileLabel: "审批", icon: ClipboardCheck },
  { id: "timesheet", order: 3, view: "timesheet", resource: "timesheet", label: "我的周表", mobileLabel: "周表", icon: Calendar },
  { id: "leave", order: 4, view: "leave", resource: "leave", label: "请假申请", mobileLabel: "请假", icon: CalendarX2 },
  { id: "report", order: 5, view: "report", resource: "report", label: "项目列表", mobileLabel: "项目", icon: FolderKanban },
  { id: "employees", order: 6, view: "employees", resource: "system_management", label: "员工与组织", mobileLabel: "员工", icon: Users },
  { id: "apps", order: 7, view: "apps", resource: "apps", label: "应用中心", mobileLabel: "应用", icon: Grid3X3 },
];

export const PAGE_TITLES = NAV_ITEMS.reduce<Record<string, string>>(
  (titles, item) => {
    titles[item.view] = item.label;
    return titles;
  },
  {},
);

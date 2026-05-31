export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-10 items-center justify-center rounded-lg bg-sidebar-bg text-white text-lg font-bold select-none">
        勤
      </div>
      <div>
        <strong className="block text-sm text-foreground leading-tight">
          工时统计系统
        </strong>
        <span className="text-xs text-muted-foreground">
          员工考勤、项目工日、组织薪酬
        </span>
      </div>
    </div>
  );
}

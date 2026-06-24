import { cn } from "@/lib/utils";
import { departmentColorClass } from "@/lib/departmentColors";

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

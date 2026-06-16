import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  nextTimesheetPeriodStart,
  previousTimesheetPeriodStart,
  timesheetPeriodStartOfDate,
} from "@/utils/dates";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface WeekNavigatorProps {
  currentWeek: string;
  onWeekChange: (week: string) => void;
}

export function WeekNavigator({ currentWeek, onWeekChange }: WeekNavigatorProps) {
  const goPrev = () => onWeekChange(previousTimesheetPeriodStart(currentWeek));
  const goNext = () => onWeekChange(nextTimesheetPeriodStart(currentWeek));

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value) {
      onWeekChange(timesheetPeriodStartOfDate(value));
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="icon"
        className="size-[38px] text-xl"
        onClick={goPrev}
        title="上一周"
      >
        <ChevronLeft className="size-5" />
      </Button>

      <Input
        type="date"
        className="h-[38px] w-36 text-sm"
        value={currentWeek}
        onChange={handleDateChange}
        title="选择任意日期，系统会自动定位到所在月内周表期间"
      />

      <Button
        variant="outline"
        size="icon"
        className="size-[38px] text-xl"
        onClick={goNext}
        title="下一周"
      >
        <ChevronRight className="size-5" />
      </Button>
    </div>
  );
}

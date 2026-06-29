import { useApprovalTasks } from "@/hooks/useApprovals";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useAppStore } from "@/stores/appStore";
import { ReviewDesktop } from "@/pages/review/ReviewDesktop";
import { ReviewMobile } from "@/pages/review/ReviewMobile";
import { computePeriodDates } from "@/components/dashboard/periodUtils";

export default function ReviewPage() {
  const {
    currentWeek,
    setCurrentWeek,
    approvalTab,
    setApprovalTab,
    reviewPeriodType,
    setReviewPeriodType,
    reviewYear,
    setReviewYear,
    reviewMonth,
    setReviewMonth,
    reviewQuarter,
    setReviewQuarter,
    reviewWeekStart,
    setReviewWeekStart,
  } = useAppStore();
  const isMobile = useIsMobile();
  const reviewedPeriod = computePeriodDates(
    reviewPeriodType,
    reviewYear,
    reviewMonth,
    reviewQuarter,
    reviewWeekStart,
  );
  const { data, isLoading, isFetching, isError } = useApprovalTasks(currentWeek, {
    reviewStartDate: reviewedPeriod.startDate,
    reviewEndDate: reviewedPeriod.endDate,
  });
  const periodProps = {
    reviewPeriodType,
    onReviewPeriodTypeChange: setReviewPeriodType,
    reviewYear,
    onReviewYearChange: setReviewYear,
    reviewMonth,
    onReviewMonthChange: setReviewMonth,
    reviewQuarter,
    onReviewQuarterChange: setReviewQuarter,
    reviewWeekStart,
    onReviewWeekStartChange: setReviewWeekStart,
  };

  if (isMobile) {
    return (
      <ReviewMobile
        data={data}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        approvalTab={approvalTab}
        onTabChange={setApprovalTab}
        currentWeek={currentWeek}
        onWeekChange={setCurrentWeek}
        {...periodProps}
      />
    );
  }

  return (
    <ReviewDesktop
      data={data}
      isLoading={isLoading}
      isFetching={isFetching}
      isError={isError}
      approvalTab={approvalTab}
      onTabChange={setApprovalTab}
      currentWeek={currentWeek}
      onWeekChange={setCurrentWeek}
      {...periodProps}
    />
  );
}

import { useApprovalTasks } from "@/hooks/useApprovals";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useAppStore } from "@/stores/appStore";
import { ReviewDesktop } from "@/pages/review/ReviewDesktop";
import { ReviewMobile } from "@/pages/review/ReviewMobile";

export default function ReviewPage() {
  const { currentWeek, setCurrentWeek, approvalTab, setApprovalTab } = useAppStore();
  const isMobile = useIsMobile();
  const { data, isLoading, isError } = useApprovalTasks(currentWeek);

  if (isMobile) {
    return (
      <ReviewMobile
        data={data}
        isLoading={isLoading}
        isError={isError}
        approvalTab={approvalTab}
        onTabChange={setApprovalTab}
        currentWeek={currentWeek}
        onWeekChange={setCurrentWeek}
      />
    );
  }

  return (
    <ReviewDesktop
      data={data}
      isLoading={isLoading}
      isError={isError}
      approvalTab={approvalTab}
      onTabChange={setApprovalTab}
      currentWeek={currentWeek}
      onWeekChange={setCurrentWeek}
    />
  );
}

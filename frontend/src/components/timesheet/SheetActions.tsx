import { Button } from "@/components/ui/button";
import type { TimesheetStatus } from "@/types/timesheet";

interface SheetActionsProps {
  status: TimesheetStatus;
  canEditSubmittedRevision?: boolean;
  hasBlockingError: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isSubmitting: boolean;
  isWithdrawing?: boolean;
  onSave: () => void;
  onSubmit: () => void;
  onWithdraw?: () => void;
}

export function SheetActions({
  status,
  canEditSubmittedRevision = false,
  hasBlockingError,
  isDirty,
  isSaving,
  isSubmitting,
  isWithdrawing = false,
  onSave,
  onSubmit,
  onWithdraw,
}: SheetActionsProps) {
  const isLocked = ["approved", "locked", "summarized"].includes(status);
  const canWithdraw = status === "submitted" && !!onWithdraw;

  if (isLocked || (status === "submitted" && !canEditSubmittedRevision)) {
    return (
      <div className="sticky bottom-0 flex justify-end gap-2 py-3 mt-3 border-t border-border bg-background">
        <span className="text-sm text-muted-foreground mr-auto self-center">
          此周表已提交或已锁定，无法编辑
        </span>
        {canWithdraw ? (
          <Button
            variant="destructive"
            onClick={onWithdraw}
            disabled={isWithdrawing}
          >
            {isWithdrawing ? "撤回中..." : "撤回周表"}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 flex justify-end gap-2 py-3 mt-3 border-t border-border bg-background">
      <span className="text-xs text-muted-foreground mr-auto self-center">
        {isDirty ? "有未保存的更改" : ""}
      </span>

      <Button
        variant="outline"
        onClick={onSave}
        disabled={isSaving || isWithdrawing}
      >
        {isSaving ? "保存中..." : "保存草稿"}
      </Button>

      {canWithdraw ? (
        <Button
          variant="destructive"
          onClick={onWithdraw}
          disabled={isWithdrawing || isSubmitting}
        >
          {isWithdrawing ? "撤回中..." : "撤回周表"}
        </Button>
      ) : null}

      <Button
        onClick={onSubmit}
        disabled={isSubmitting || isWithdrawing || hasBlockingError}
        title={hasBlockingError ? "请先修正每日合计超过 100% 的项目" : undefined}
      >
        {isSubmitting ? "提交中..." : "提交审核"}
      </Button>
    </div>
  );
}

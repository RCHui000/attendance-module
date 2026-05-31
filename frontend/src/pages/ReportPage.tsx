import { ProjectList } from "@/components/report/ProjectList";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useProjectBase } from "@/hooks/useReport";

export default function ReportPage() {
  const { refetch } = useProjectBase();

  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-3.5 mr-1" />
          刷新
        </Button>
      </div>

      <ProjectList />
    </div>
  );
}

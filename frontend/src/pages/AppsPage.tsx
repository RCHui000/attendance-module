import { ExternalLink, Network, RadioTower } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const APPS = [
  {
    id: "tender-aggregator-intranet",
    name: "招标信息聚合(内网)",
    description: "公司内网部署的招标信息聚合入口，需在公司网络访问。",
    url: "http://192.168.2.100:9978",
    badge: "内网",
  },
] as const;

export default function AppsPage() {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">应用中心</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            统一进入公司内部工具和业务应用。
          </p>
        </div>
        <Badge variant="secondary">{APPS.length} 个应用</Badge>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {APPS.map((app) => (
          <Card key={app.id} className="rounded-lg p-4 shadow-app">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <RadioTower className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold">{app.name}</h3>
                  <Badge variant="outline">{app.badge}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {app.description}
                </p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <Network className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">192.168.2.100:9978</span>
                  </span>
                  <a
                    href={app.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
                  >
                    打开
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

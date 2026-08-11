"use client";

import { useMemo, useState } from "react";

import { Composer } from "@/components/composer";
import { Inspector } from "@/components/inspector";
import {
  DlqPanel,
  EventLog,
  RateLimiterPanel,
  StatTile,
} from "@/components/panels";
import { Pipeline } from "@/components/pipeline";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { usePipeline } from "@/lib/usePipeline";
import { cn } from "@/lib/utils";

export function Dashboard() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const snapshot = usePipeline();
  const { metrics, byStage, queue, dlq, events, notifications } = snapshot;

  // Ingress rate, derived from row timestamps rather than a server counter.
  const acceptedRecently = useMemo(() => {
    const cutoff = Date.now() - 60_000;
    return notifications.filter(
      (item) => new Date(item.createdAt).getTime() >= cutoff,
    ).length;
  }, [notifications]);

  const failurePercent = Math.round(
    (metrics?.failureRate.failureRatio ?? 0) * 100,
  );

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <h1 className="text-sm font-semibold tracking-tight">Pulse</h1>
            <span className="text-[11px] text-muted-foreground">
              notification dispatch, from accept to delivery
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Badge
              variant="outline"
              className="gap-1.5 font-mono text-[10px]"
              title={snapshot.error ?? undefined}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  snapshot.connected ? "bg-ok pulse-dot" : "bg-destructive",
                )}
              />
              {snapshot.connected ? "polling 1s" : "api unreachable"}
            </Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Queue depth"
            value={queue?.depth ?? 0}
            hint={`${metrics?.queue.visibleDepth ?? 0} claimable now`}
          />
          <StatTile
            label="Active workers"
            value={metrics?.workers.activeCount ?? 0}
            hint="holding a visibility lease"
          />
          <StatTile
            label="Delivered · 1h"
            value={metrics?.throughput.last1h ?? 0}
            hint={`${metrics?.throughput.last24h ?? 0} in 24h`}
            tone="ok"
          />
          <StatTile
            label="Failure rate · 1m"
            value={`${failurePercent}%`}
            hint={`${metrics?.failureRate.failedAttempts ?? 0}/${
              metrics?.failureRate.totalAttempts ?? 0
            } attempts`}
            tone={failurePercent > 40 ? "danger" : "warn"}
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="space-y-3">
            <Composer onSent={snapshot.refresh} note={snapshot.note} />
            <RateLimiterPanel metrics={metrics} />
            <EventLog events={events} onSelect={setSelectedId} />
          </div>

          <div className="space-y-3">
            <Pipeline
              byStage={byStage}
              metrics={metrics}
              queue={queue}
              total={notifications.length}
              acceptedRecently={acceptedRecently}
              selectedId={selectedId}
              onSelect={setSelectedId}
              schedulerIntervalHint="advisory lock · promotes due jobs"
            />
            <DlqPanel
              items={dlq}
              onChanged={snapshot.refresh}
              onSelect={setSelectedId}
            />
          </div>
        </div>
      </main>

      <Inspector
        notificationId={selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  );
}

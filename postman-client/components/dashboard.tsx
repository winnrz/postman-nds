"use client";

import { useState } from "react";

import { Inspector } from "@/components/inspector";
import { EventLog, RateLimiterPanel } from "@/components/panels";
import { Pipeline } from "@/components/pipeline";
import { SendPanel } from "@/components/send-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { usePipeline } from "@/lib/usePipeline";
import { cn } from "@/lib/utils";

export function Dashboard() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const snapshot = usePipeline();
  const { metrics, byStage, queue, events, notifications, acceptedRecently } =
    snapshot;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2.5">
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
              {snapshot.connected ? "live" : "api unreachable"}
            </Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-3 p-4">
        <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="space-y-3">
            <SendPanel onSent={snapshot.refresh} note={snapshot.note} />
            <RateLimiterPanel metrics={metrics} />
            <EventLog events={events} onSelect={setSelectedId} />
          </div>

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
        </div>
      </main>

      <Inspector
        notificationId={selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  );
}

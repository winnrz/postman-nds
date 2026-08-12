"use client";

import { Activity, Gauge } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Metrics } from "@/lib/types";
import type { PipelineEvent } from "@/lib/usePipeline";
import { cn } from "@/lib/utils";

export function RateLimiterPanel({ metrics }: { metrics: Metrics | null }) {
  const buckets = Object.entries(metrics?.rateLimiter ?? {});

  return (
    <Card size="sm" className="gap-2">
      <div className="flex items-center gap-2 px-3">
        <Gauge className="size-3.5 text-warn" />
        <h2 className="text-xs font-medium">Rate limiter</h2>
        <Badge variant="outline" className="ml-auto font-mono text-[10px]">
          redis token bucket
        </Badge>
      </div>

      <div className="space-y-2 px-3">
        {buckets.length === 0 && (
          <p className="text-[10px] text-muted-foreground/60">
            waiting for metrics…
          </p>
        )}
        {buckets.map(([channel, bucket]) => {
          const ratio = bucket.limit === 0 ? 0 : bucket.tokens / bucket.limit;
          return (
            <div key={channel} className="space-y-1">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-muted-foreground">{channel}</span>
                {bucket.available ? (
                  <span
                    className={cn(
                      ratio < 0.2 ? "text-warn" : "text-muted-foreground",
                    )}
                  >
                    {bucket.tokens}/{bucket.limit} per min
                  </span>
                ) : (
                  <span className="text-destructive">redis unreachable</span>
                )}
              </div>
              <Progress
                value={Math.round(ratio * 100)}
                className={cn(
                  "[&_[data-slot=progress-indicator]]:bg-ok",
                  ratio < 0.2 &&
                    "[&_[data-slot=progress-indicator]]:bg-destructive",
                )}
              />
            </div>
          );
        })}
        <p className="pt-0.5 text-[10px] leading-relaxed text-muted-foreground">
          A worker that cannot take a token puts the job back with a 10s delay
          instead of blocking.
        </p>
      </div>
    </Card>
  );
}


const EVENT_TONE: Record<PipelineEvent["kind"], string> = {
  created: "text-primary",
  moved: "text-muted-foreground",
  delivered: "text-ok",
  failed: "text-destructive",
  note: "text-warn",
};

export function EventLog({
  events,
  onSelect,
}: {
  events: PipelineEvent[];
  onSelect: (id: string) => void;
}) {
  return (
    <Card size="sm" className="gap-2">
      <div className="flex items-center gap-2 px-3">
        <Activity className="size-3.5 text-primary" />
        <h2 className="text-xs font-medium">Transitions</h2>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          diffed each poll
        </span>
      </div>

      <ScrollArea className="h-56">
        <div className="space-y-0.5 px-3 pb-1">
          {events.length === 0 && (
            <p className="py-2 text-[10px] text-muted-foreground/60">
              Send something — every state change shows up here.
            </p>
          )}
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() =>
                event.notificationId && onSelect(event.notificationId)
              }
              className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left font-mono text-[10px] hover:bg-muted/60"
            >
              <span className="shrink-0 text-muted-foreground/60">
                {new Date(event.at).toLocaleTimeString([], {
                  hour12: false,
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              <span className={cn("truncate", EVENT_TONE[event.kind])}>
                {event.text}
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}

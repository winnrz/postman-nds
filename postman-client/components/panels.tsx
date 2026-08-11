"use client";

import { useState } from "react";
import { Activity, Gauge, RefreshCcw, Skull } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import type { DlqItem, Metrics } from "@/lib/types";
import type { PipelineEvent } from "@/lib/usePipeline";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  const toneClass = {
    default: "text-foreground",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-destructive",
  }[tone];

  return (
    <Card size="sm" className="gap-0.5">
      <div className="px-3 text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className={cn("px-3 font-mono text-lg leading-tight", toneClass)}>
        {value}
      </div>
      {hint && (
        <div className="px-3 font-mono text-[10px] text-muted-foreground/70">
          {hint}
        </div>
      )}
    </Card>
  );
}

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

export function DlqPanel({
  items,
  onChanged,
  onSelect,
}: {
  items: DlqItem[];
  onChanged: () => void;
  onSelect: (id: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const pending = items.filter((item) => !item.requeuedAt);

  async function requeue(id: string) {
    setBusy(id);
    try {
      await api.requeue(id);
      toast.success("Requeued", {
        description: "attemptCount reset, new queue row inserted",
      });
      onChanged();
    } catch (error) {
      toast.error("Requeue failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  async function requeueAll() {
    setBusy("all");
    try {
      const { requeued } = await api.requeueAll();
      toast.success(`Requeued ${requeued}`);
      onChanged();
    } catch (error) {
      toast.error("Requeue-all failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card size="sm" className="gap-2">
      <div className="flex items-center gap-2 px-3">
        <Skull className="size-3.5 text-destructive" />
        <h2 className="text-xs font-medium">Dead letter queue</h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          {pending.length} replayable
        </span>
        <Button
          size="xs"
          variant="outline"
          className="ml-auto"
          disabled={pending.length === 0 || busy !== null}
          onClick={requeueAll}
        >
          <RefreshCcw /> Requeue all
        </Button>
      </div>

      <ScrollArea className="h-44">
        <div className="space-y-1 px-3 pb-1">
          {items.length === 0 && (
            <p className="py-2 text-[10px] text-muted-foreground/60">
              Nothing dead-lettered. Permanent 4xx failures and jobs that burn
              through maxAttempts land here.
            </p>
          )}
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5"
            >
              <button
                type="button"
                onClick={() => onSelect(item.notificationId)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px]">
                    {item.notificationId.slice(0, 8)}
                  </span>
                  <Badge
                    variant="destructive"
                    className="h-4 px-1 font-mono text-[9px]"
                  >
                    {item.errorCode ?? "err"}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    ×{item.attemptCount}
                  </span>
                </div>
                <p className="truncate text-[10px] text-muted-foreground">
                  {item.failureReason}
                </p>
              </button>
              {item.requeuedAt ? (
                <Badge variant="outline" className="text-[9px]">
                  requeued
                </Badge>
              ) : (
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => requeue(item.id)}
                >
                  Requeue
                </Button>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
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

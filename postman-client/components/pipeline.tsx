"use client";

import { Fragment, type ReactNode } from "react";
import {
  AlertOctagon,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  ListOrdered,
  RotateCcw,
  Send,
  Signal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  Channel,
  Metrics,
  QueueSnapshot,
  Stage,
  TrackedNotification,
} from "@/lib/types";

type Tone = "neutral" | "primary" | "ok" | "warn" | "danger" | "violet";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  primary: "text-primary",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-destructive",
  violet: "text-violet",
};

const CHANNEL_DOT: Record<Channel, string> = {
  EMAIL: "bg-info",
  SMS: "bg-violet",
};

function Chip({
  item,
  selected,
  onSelect,
  trailing,
}: {
  item: TrackedNotification;
  selected: boolean;
  onSelect: (id: string) => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      title={`${item.recipientId} · ${item.channel} · ${item.priority}`}
      className={cn(
        "chip-in flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left font-mono text-[11px] ring-1 transition-colors",
        selected
          ? "bg-primary/10 text-foreground ring-primary/50"
          : "bg-muted/40 text-muted-foreground ring-foreground/8 hover:bg-muted hover:text-foreground",
      )}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", CHANNEL_DOT[item.channel])}
      />
      <span className="truncate">{item.id.slice(0, 6)}</span>
      {item.priority === "HIGH" && (
        <span className="shrink-0 text-[9px] text-warn">HI</span>
      )}
      <span className="ml-auto shrink-0 text-[10px] opacity-70">
        {trailing ?? item.recipientId.slice(0, 9)}
      </span>
    </button>
  );
}

function ChipList({
  items,
  selectedId,
  onSelect,
  empty,
  trailingFor,
  max = 6,
}: {
  items: TrackedNotification[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  empty: string;
  trailingFor?: (item: TrackedNotification) => ReactNode;
  max?: number;
}) {
  if (items.length === 0) {
    return (
      <p className="py-1 text-[10px] text-muted-foreground/60">{empty}</p>
    );
  }

  const shown = items.slice(0, max);
  const overflow = items.length - shown.length;

  return (
    <div className="flex flex-col gap-1">
      {shown.map((item) => (
        <Chip
          key={item.id}
          item={item}
          selected={item.id === selectedId}
          onSelect={onSelect}
          trailing={trailingFor?.(item)}
        />
      ))}
      {overflow > 0 && (
        <p className="px-1 font-mono text-[10px] text-muted-foreground">
          +{overflow} more
        </p>
      )}
    </div>
  );
}

function StageCard({
  icon,
  label,
  detail,
  count,
  tone = "neutral",
  active,
  children,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  count: number;
  tone?: Tone;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Card
      size="sm"
      className={cn(
        "h-full gap-2 transition-shadow",
        active && "ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-center gap-1.5 px-3">
        <span className={cn("shrink-0", TONE_TEXT[tone])}>{icon}</span>
        <span className="truncate text-xs font-medium">{label}</span>
        <span
          className={cn(
            "ml-auto font-mono text-sm tabular-nums",
            count > 0 ? TONE_TEXT[tone] : "text-muted-foreground/50",
          )}
        >
          {count}
        </span>
      </div>
      <p className="-mt-1 truncate px-3 font-mono text-[10px] text-muted-foreground/70">
        {detail}
      </p>
      <div className="px-3 pb-0.5">{children}</div>
    </Card>
  );
}

/** Animated dashes between stages — only meaningful on a wide layout. */
function Connector() {
  return (
    <div className="hidden w-5 shrink-0 items-center lg:flex" aria-hidden>
      <svg viewBox="0 0 20 6" className="w-full" preserveAspectRatio="none">
        <line
          x1="0"
          y1="3"
          x2="20"
          y2="3"
          className="flow-line stroke-border"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}

export function Pipeline({
  byStage,
  metrics,
  queue,
  total,
  acceptedRecently,
  selectedId,
  onSelect,
  schedulerIntervalHint,
}: {
  byStage: Record<Stage, TrackedNotification[]>;
  metrics: Metrics | null;
  queue: QueueSnapshot | null;
  total: number;
  acceptedRecently: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  schedulerIntervalHint: string;
}) {
  const inFlight = byStage.IN_FLIGHT;
  const rateLimited = byStage.RATE_LIMITED;
  const queued = [...byStage.QUEUED, ...rateLimited];

  // Workers actually holding jobs right now, from the queue rows.
  const workers = [...new Set(inFlight.map((item) => item.workerId ?? "?"))];

  const providers = Object.entries(metrics?.sendRates.byProvider ?? {});
  const failureRatio = metrics?.failureRate.failureRatio ?? 0;

  const stages = [
    {
      key: "api",
      node: (
        <StageCard
          icon={<Send className="size-3.5" />}
          label="API"
          detail="POST /notifications"
          count={acceptedRecently}
          tone="primary"
          active={acceptedRecently > 0}
        >
          <div className="space-y-1 text-[10px] text-muted-foreground">
            <p>accepted in last 60s</p>
            <p className="font-mono">validate → idempotency key → insert</p>
          </div>
        </StageCard>
      ),
    },
    {
      key: "db",
      node: (
        <StageCard
          icon={<Database className="size-3.5" />}
          label="Postgres"
          detail="notifications table"
          count={total}
          tone="neutral"
        >
          <dl className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
            <Ledger label="scheduled" value={byStage.SCHEDULED.length} />
            <Ledger
              label="pending"
              value={queued.length + inFlight.length + byStage.BACKOFF.length}
            />
            <Ledger label="delivered" value={byStage.DELIVERED.length} />
            <Ledger label="failed" value={byStage.DLQ.length} />
          </dl>
        </StageCard>
      ),
    },
    {
      key: "scheduler",
      node: (
        <StageCard
          icon={<Clock className="size-3.5" />}
          label="Scheduler"
          detail={schedulerIntervalHint}
          count={byStage.SCHEDULED.length}
          tone="violet"
        >
          <ChipList
            items={byStage.SCHEDULED}
            selectedId={selectedId}
            onSelect={onSelect}
            empty="nothing scheduled"
          />
        </StageCard>
      ),
    },
    {
      key: "queue",
      node: (
        <StageCard
          icon={<ListOrdered className="size-3.5" />}
          label="Queue"
          detail={`depth ${queue?.depth ?? 0} · visible ${metrics?.queue.visibleDepth ?? 0}`}
          count={queued.length}
          tone="primary"
        >
          <ChipList
            items={queued}
            selectedId={selectedId}
            onSelect={onSelect}
            empty="queue empty"
            trailingFor={(item) =>
              item.stage === "RATE_LIMITED" ? (
                <span className="text-warn">limited</span>
              ) : undefined
            }
          />
        </StageCard>
      ),
    },
    {
      key: "workers",
      node: (
        <StageCard
          icon={<Cpu className="size-3.5" />}
          label="Workers"
          detail={
            workers.length > 0 ? workers.join(", ") : "polling for visible jobs"
          }
          count={inFlight.length}
          tone="primary"
          active={inFlight.length > 0}
        >
          <ChipList
            items={inFlight}
            selectedId={selectedId}
            onSelect={onSelect}
            empty="no jobs claimed"
            trailingFor={(item) => `#${item.attemptCount + 1}`}
          />
        </StageCard>
      ),
    },
    {
      key: "dispatch",
      node: (
        <StageCard
          icon={<Signal className="size-3.5" />}
          label="Dispatch"
          detail="provider handlers"
          count={metrics?.sendRates.successfulAttempts ?? 0}
          tone="violet"
        >
          <div className="space-y-1">
            {providers.length === 0 && (
              <p className="py-1 text-[10px] text-muted-foreground/60">
                no sends in the last minute
              </p>
            )}
            {providers.map(([provider, count]) => (
              <div
                key={provider}
                className="flex items-center justify-between rounded-md bg-muted/40 px-1.5 py-1 font-mono text-[10px]"
              >
                <span className="truncate">{provider.toLowerCase()}</span>
                <span className="text-ok">{count}</span>
              </div>
            ))}
            <p className="pt-0.5 font-mono text-[10px] text-muted-foreground">
              fail {(failureRatio * 100).toFixed(0)}% / 1m
            </p>
          </div>
        </StageCard>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:flex lg:items-stretch lg:gap-0">
        {stages.map((stage, index) => (
          <Fragment key={stage.key}>
            {index > 0 && <Connector />}
            <div className="lg:min-w-0 lg:flex-1">{stage.node}</div>
          </Fragment>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StageCard
          icon={<CheckCircle2 className="size-3.5" />}
          label="Delivered"
          detail="terminal · providerMessageId stored"
          count={byStage.DELIVERED.length}
          tone="ok"
        >
          <ChipList
            items={byStage.DELIVERED}
            selectedId={selectedId}
            onSelect={onSelect}
            empty="nothing delivered yet"
            max={5}
          />
        </StageCard>

        <StageCard
          icon={<RotateCcw className="size-3.5" />}
          label="Retry backoff"
          detail="invisible until the timeout expires → back to queue"
          count={byStage.BACKOFF.length}
          tone="warn"
        >
          <ChipList
            items={byStage.BACKOFF}
            selectedId={selectedId}
            onSelect={onSelect}
            empty="no jobs waiting on backoff"
            max={5}
            trailingFor={(item) => (
              <span className="text-warn">{item.waitSeconds.toFixed(0)}s</span>
            )}
          />
        </StageCard>

        <StageCard
          icon={<AlertOctagon className="size-3.5" />}
          label="Dead letter queue"
          detail="permanent 4xx, or maxAttempts exhausted"
          count={byStage.DLQ.length}
          tone="danger"
        >
          <ChipList
            items={byStage.DLQ}
            selectedId={selectedId}
            onSelect={onSelect}
            empty="no dead letters"
            max={5}
            trailingFor={(item) => (
              <Badge variant="destructive" className="h-4 px-1 text-[9px]">
                {item.failureReason?.split(":")[0] ?? "fail"}
              </Badge>
            )}
          />
        </StageCard>
      </div>
    </div>
  );
}

function Ledger({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className={value > 0 ? "text-foreground" : ""}>{value}</dd>
    </div>
  );
}

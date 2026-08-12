"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import type {
  DlqItem,
  Metrics,
  QueueSnapshot,
  Stage,
  TrackedNotification,
} from "./types";

export type PipelineEvent = {
  id: string;
  at: number;
  kind: "created" | "moved" | "delivered" | "failed" | "note";
  notificationId?: string;
  text: string;
};

export type PipelineSnapshot = {
  notifications: TrackedNotification[];
  /** Accepted in the last minute — computed here, where a poll timestamp already exists. */
  acceptedRecently: number;
  byStage: Record<Stage, TrackedNotification[]>;
  metrics: Metrics | null;
  queue: QueueSnapshot | null;
  dlq: DlqItem[];
  events: PipelineEvent[];
  connected: boolean;
  error: string | null;
  refresh: () => void;
  note: (text: string, notificationId?: string) => void;
};

const EMPTY_STAGES: Record<Stage, TrackedNotification[]> = {
  SCHEDULED: [],
  QUEUED: [],
  RATE_LIMITED: [],
  IN_FLIGHT: [],
  BACKOFF: [],
  DELIVERED: [],
  DLQ: [],
};

const STAGE_LABEL: Record<Stage, string> = {
  SCHEDULED: "waiting on the scheduler",
  QUEUED: "queued",
  RATE_LIMITED: "held by the rate limiter",
  IN_FLIGHT: "claimed by a worker",
  BACKOFF: "waiting out backoff",
  DELIVERED: "delivered",
  DLQ: "dead-lettered",
};

const MAX_EVENTS = 60;

let eventSeq = 0;

/**
 * Default poll interval. Hosted deployments bill the egress this generates, so
 * it is worth loosening there — 1s is a local-demo cadence.
 */
export const DEFAULT_POLL_INTERVAL_MS = Number(
  process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? 1000,
);

/**
 * Polls the three read endpoints in lockstep and merges them into one view of
 * the system. Polling (rather than a stream) mirrors how the workers and
 * scheduler themselves observe the queue.
 *
 * Polling stops while the tab is hidden and resumes immediately on return —
 * without that, a dashboard left open in a background tab keeps hitting the API
 * around the clock.
 */
export function usePipeline(
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
): PipelineSnapshot {
  const [notifications, setNotifications] = useState<TrackedNotification[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [dlq, setDlq] = useState<DlqItem[]>([]);
  const [acceptedRecently, setAcceptedRecently] = useState(0);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Previous stage per notification, used to emit transition events.
  const stageMemory = useRef(new Map<string, Stage>());
  const tickRef = useRef(0);
  const [manualTick, setManualTick] = useState(0);

  const pushEvents = useCallback((incoming: Omit<PipelineEvent, "id">[]) => {
    if (incoming.length === 0) return;
    setEvents((current) =>
      [
        ...incoming.map((event) => ({ ...event, id: `e${eventSeq++}` })),
        ...current,
      ].slice(0, MAX_EVENTS),
    );
  }, []);

  const note = useCallback(
    (text: string, notificationId?: string) => {
      pushEvents([{ at: Date.now(), kind: "note", text, notificationId }]);
    },
    [pushEvents],
  );

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const hidden = () => document.visibilityState === "hidden";

    function clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    // A hidden tab schedules nothing; `visibilitychange` restarts the loop.
    function schedule() {
      if (cancelled || hidden()) return;
      timer = setTimeout(tick, intervalMs);
    }

    async function tick() {
      if (inFlight) return;
      inFlight = true;
      try {
        const [metricsResult, queueResult, listResult, dlqResult] =
          await Promise.all([
            api.metrics(),
            api.queue(),
            api.notifications(),
            api.dlq(),
          ]);

        if (cancelled) return;

        const queueByNotification = new Map(
          queueResult.items.map((item) => [item.notificationId, item]),
        );

        const tracked: TrackedNotification[] = listResult.items.map((row) => {
          const queued = queueByNotification.get(row.id);
          let stage: Stage;

          if (row.status === "DELIVERED") stage = "DELIVERED";
          else if (row.status === "FAILED") stage = "DLQ";
          else if (row.status === "SCHEDULED") stage = "SCHEDULED";
          else if (!queued) stage = "QUEUED";
          else if (queued.state === "IN_FLIGHT") stage = "IN_FLIGHT";
          else if (queued.state === "BACKOFF") stage = "BACKOFF";
          else if (queued.state === "RATE_LIMITED") stage = "RATE_LIMITED";
          else stage = "QUEUED";

          return {
            ...row,
            stage,
            attemptCount: queued?.attemptCount ?? 0,
            maxAttempts: queued?.maxAttempts ?? 5,
            workerId: queued?.workerId ?? null,
            waitSeconds: queued?.waitSeconds ?? 0,
            failureReason: queued?.failureReason ?? null,
          };
        });

        // Diff against the last poll to narrate what moved.
        const now = Date.now();
        const batch: Omit<PipelineEvent, "id">[] = [];
        const seen = new Set<string>();
        const firstRun = stageMemory.current.size === 0;

        for (const item of tracked) {
          seen.add(item.id);
          const previous = stageMemory.current.get(item.id);
          stageMemory.current.set(item.id, item.stage);

          if (firstRun) continue;
          if (previous === item.stage) continue;

          const short = item.id.slice(0, 8);
          if (previous === undefined) {
            batch.push({
              at: now,
              kind: "created",
              notificationId: item.id,
              text: `${short} accepted → ${STAGE_LABEL[item.stage]}`,
            });
            continue;
          }

          if (item.stage === "DELIVERED") {
            batch.push({
              at: now,
              kind: "delivered",
              notificationId: item.id,
              text: `${short} delivered`,
            });
          } else if (item.stage === "DLQ") {
            batch.push({
              at: now,
              kind: "failed",
              notificationId: item.id,
              text: `${short} dead-lettered`,
            });
          } else {
            batch.push({
              at: now,
              kind: "moved",
              notificationId: item.id,
              text: `${short} → ${STAGE_LABEL[item.stage]}`,
            });
          }
        }

        // Forget rows that have aged off the page we poll.
        for (const id of stageMemory.current.keys()) {
          if (!seen.has(id)) stageMemory.current.delete(id);
        }

        // Ingress rate, derived from row timestamps rather than a server counter.
        const acceptedCutoff = now - 60_000;
        setAcceptedRecently(
          tracked.filter(
            (item) => new Date(item.createdAt).getTime() >= acceptedCutoff,
          ).length,
        );

        setNotifications(tracked);
        setMetrics(metricsResult);
        setQueue(queueResult);
        setDlq(dlqResult.items);
        setConnected(true);
        setError(null);
        pushEvents(batch);
      } catch (caught) {
        if (cancelled) return;
        setConnected(false);
        setError(caught instanceof Error ? caught.message : "Request failed");
      } finally {
        inFlight = false;
        schedule();
      }
    }

    function onVisibilityChange() {
      clearTimer();
      // Coming back into view, refresh at once rather than showing a stale
      // board for up to a full interval.
      if (!hidden()) void tick();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    void tick();

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, manualTick, pushEvents]);

  const byStage = { ...EMPTY_STAGES };
  for (const key of Object.keys(byStage) as Stage[]) byStage[key] = [];
  for (const item of notifications) byStage[item.stage].push(item);

  const refresh = useCallback(() => {
    tickRef.current += 1;
    setManualTick(tickRef.current);
  }, []);

  return {
    notifications,
    acceptedRecently,
    byStage,
    metrics,
    queue,
    dlq,
    events,
    connected,
    error,
    refresh,
    note,
  };
}

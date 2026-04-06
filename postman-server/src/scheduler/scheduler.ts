import { NotificationStatus } from "../generated/prisma/client";
import { prisma } from "../plugins/prisma";
import sleep from "../utils/sleep";
import {
  acquireSchedulerLock,
  emitHighVolumeAlertIfNeeded,
  releaseSchedulerLock,
} from "./scheduler.utils";

type ScheduledForQueue = {
  id: string;
  priority: import("../generated/prisma/client").NotificationPriority;
};

async function enqueueDueScheduledNotifications(now: Date): Promise<number> {
  // One transaction keeps state transition + queue inserts consistent for this batch.
  return prisma.$transaction(async (tx) => {
    const due = await tx.notifications.findMany({
      where: {
        status: NotificationStatus.SCHEDULED,
        scheduledAt: { lte: now },
      },
      // Deterministic ordering preserves FIFO within scheduled backlog.
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        priority: true,
      },
    });

    if (due.length === 0) return 0;

    const ids = due.map((n) => n.id);
    // Idempotent state flip guard: only rows still SCHEDULED are promoted to PENDING.
    const updated = await tx.notifications.updateMany({
      where: {
        id: { in: ids },
        status: NotificationStatus.SCHEDULED,
      },
      data: {
        status: NotificationStatus.PENDING,
        enqueuedAt: now,
      },
    });

    if (updated.count === 0) return 0;

    // Re-read effective PENDING set so only actually promoted rows are queued.
    const stillPending = await tx.notifications.findMany({
      where: {
        id: { in: ids },
        status: NotificationStatus.PENDING,
      },
      select: {
        id: true,
        priority: true,
      },
    });

    if (stillPending.length === 0) return 0;

    await tx.notificationQueue.createMany({
      data: stillPending.map((n: ScheduledForQueue) => ({
        notificationId: n.id,
        priority: n.priority,
      })),
      // Protects against duplicate queue rows across retries/restarts.
      skipDuplicates: true,
    });

    return stillPending.length;
  });
}

export async function runSchedulerCycle(): Promise<number> {
  const lockAcquired = await acquireSchedulerLock(prisma);
  if (!lockAcquired) return 0;

  try {
    const now = new Date();
    const enqueued = await enqueueDueScheduledNotifications(now);

    // eslint-disable-next-line no-console
    console.info(`[scheduler] enqueued ${enqueued} scheduled notifications`);
    emitHighVolumeAlertIfNeeded(enqueued);

    return enqueued;
  } finally {
    await releaseSchedulerLock(prisma);
  }
}

export async function startScheduler(
  intervalMs = 60_000,
): Promise<NodeJS.Timeout> {
  // Continuous poll loop; errors are logged so one failed cycle does not stop scheduling.
  while (true) {
    await runSchedulerCycle().catch((error) => {
      // eslint-disable-next-line no-console
      console.error("[scheduler] runSchedulerCycle failed", error);
    });

    await sleep(intervalMs);
  }
}

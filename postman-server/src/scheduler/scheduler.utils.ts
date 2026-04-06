import { PrismaClient } from "../generated/prisma/client";

const SCHEDULER_LOCK_KEY = 9_210_021;
const HIGH_VOLUME_ALERT_THRESHOLD = 1000;

export async function acquireSchedulerLock(
  db: PrismaClient,
): Promise<boolean> {
  // Cross-process singleton guard so only one scheduler instance enqueues due jobs per cycle.
  const rows = await db.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(${SCHEDULER_LOCK_KEY}) AS locked
  `;
  return rows[0]?.locked === true;
}

export async function releaseSchedulerLock(db: PrismaClient): Promise<void> {
  await db.$executeRaw`
    SELECT pg_advisory_unlock(${SCHEDULER_LOCK_KEY})
  `;
}

export function emitHighVolumeAlertIfNeeded(enqueuedCount: number): void {
  if (enqueuedCount <= HIGH_VOLUME_ALERT_THRESHOLD) return;
  // placeholder alert; wire to pager/metrics sink in prod.
  // eslint-disable-next-line no-console
  console.warn(
    `[scheduler] high scheduled enqueue volume: ${enqueuedCount}`,
  );
}

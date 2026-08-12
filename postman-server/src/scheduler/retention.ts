import { prisma } from "../plugins/prisma";

/**
 * The API accepts writes from anyone, so without a ceiling the tables grow for
 * as long as the demo is online. Seven days keeps `/metrics` honest — it reports
 * throughput over 1h, 24h and 7d, and a shorter retention would make the widest
 * window structurally incapable of showing what it claims.
 */
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 7);

// Bounded so a large backlog is cleared over several cycles instead of one long
// transaction holding locks against the queue the workers are polling.
const MAX_DELETES_PER_CYCLE = Number(
  process.env.RETENTION_MAX_DELETES_PER_CYCLE ?? 500,
);

export async function purgeExpiredNotifications(now: Date): Promise<number> {
  if (RETENTION_DAYS <= 0) return 0;

  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Terminal rows only. Anything still SCHEDULED, PENDING or PROCESSING is
  // in-flight work — age alone is not a reason to drop it, and deleting a row a
  // worker currently holds would surface as a confusing foreign-key failure.
  const expired = await prisma.notifications.findMany({
    where: {
      createdAt: { lt: cutoff },
      status: { in: ["DELIVERED", "FAILED"] },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_DELETES_PER_CYCLE,
    select: { id: true },
  });

  if (expired.length === 0) return 0;

  // AttemptLog, NotificationQueue and DeadLetterQueue all declare
  // `onDelete: Cascade`, so removing the notification takes its history with it.
  const deleted = await prisma.notifications.deleteMany({
    where: { id: { in: expired.map((row) => row.id) } },
  });

  return deleted.count;
}

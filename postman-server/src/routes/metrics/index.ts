import { FastifyPluginAsync } from "fastify";

import { prisma } from "../../plugins/prisma";
import { getRateLimitState } from "../../workers/rateLimiter";

const root: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get("/", async (_request, reply) => {
    // Metrics are derived from DB state (queue + attempt logs). No in-memory limiter state exists yet.
    const now = new Date();

    const last1h = new Date(now.getTime() - 60 * 60 * 1000);
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const last1min = new Date(now.getTime() - 60_000);

    // Queue depth: number of queue entries (includes in-flight and waiting).
    // Visible depth: entries claimable right now (matches worker claim logic).
    const [queueDepth, visibleQueueDepth] = await Promise.all([
      prisma.notificationQueue.count(),
      prisma.notificationQueue.count({
        where: {
          OR: [
            { visibilityTimeout: null },
            { visibilityTimeout: { lte: now } },
          ],
        },
      }),
    ]);

    // Active workers: distinct workerIds currently holding a visibility timeout in the future.
    const activeWorkers = await prisma.notificationQueue.groupBy({
      by: ["workerId"],
      where: {
        workerId: { not: null },
        visibilityTimeout: { gt: now },
      },
      _count: { _all: true },
    });

    // Throughput + failure rate from attempt logs in the recent window.
    const [totalAttempts, successfulAttempts, failedAttempts, sentByProvider] =
      await Promise.all([
        prisma.attemptLog.count({
          where: { attemptedAt: { gte: last1min } },
        }),
        prisma.attemptLog.count({
          where: { attemptedAt: { gte: last1min }, success: true },
        }),
        prisma.attemptLog.count({
          where: { attemptedAt: { gte: last1min }, success: false },
        }),
        prisma.attemptLog.groupBy({
          by: ["provider"],
          where: { attemptedAt: { gte: last1min }, success: true },
          _count: { _all: true },
        }),
      ]);

    const [sent1h, sent24h, sent7d] = await Promise.all([
      prisma.attemptLog.count({
        where: { attemptedAt: { gte: last1h }, success: true },
      }),
      prisma.attemptLog.count({
        where: { attemptedAt: { gte: last24h }, success: true },
      }),
      prisma.attemptLog.count({
        where: { attemptedAt: { gte: last7d }, success: true },
      }),
    ]);

    const failureRatio =
      totalAttempts === 0 ? 0 : failedAttempts / totalAttempts;

    const sendByProvider: Record<string, number> = {};
    for (const row of sentByProvider) {
      const providerKey = row.provider ?? "UNKNOWN";
      sendByProvider[String(providerKey)] = row._count._all;
    }

    return reply.send({
      timestamp: now.toISOString(),
      queue: {
        depth: queueDepth,
        visibleDepth: visibleQueueDepth,
      },
      workers: {
        activeCount: activeWorkers.length,
      },
      sendRates: {
        successfulAttempts,
        byProvider: sendByProvider,
      },
      throughput: {
        last1h: sent1h,
        last24h: sent24h,
        last7d: sent7d,
      },
      failureRate: {
        totalAttempts,
        failedAttempts,
        failureRatio,
      },
      rateLimiter: await getRateLimitState(),
    });
  });
};

export default root;

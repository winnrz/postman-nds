import { FastifyPluginAsync } from "fastify";

import { prisma } from "../../plugins/prisma";
import { parsePositiveInt } from "../../utils";

/**
 * Why a job is where it is, derived from the queue row rather than stored:
 * - READY        claimable on the next worker poll
 * - IN_FLIGHT    held by a worker inside its visibility window
 * - BACKOFF      failed at least once, waiting out exponential backoff
 * - RATE_LIMITED released by a worker that could not get a token
 */
const queueItemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    notificationId: { type: "string" },
    priority: { type: "string" },
    state: { type: "string" },
    workerId: { type: ["string", "null"] },
    visibilityTimeout: { type: ["string", "null"] },
    // Seconds until this row becomes claimable again; 0 when already visible.
    waitSeconds: { type: "number" },
    createdAt: { type: "string" },
    recipientId: { type: "string" },
    channel: { type: "string" },
    status: { type: "string" },
    subject: { type: ["string", "null"] },
    body: { type: ["string", "null"] },
    attemptCount: { type: "integer" },
    maxAttempts: { type: "integer" },
    failureReason: { type: ["string", "null"] },
  },
} as const;

const listQueueSchema = {
  querystring: {
    type: "object",
    properties: {
      limit: { type: "string", pattern: "^[1-9][0-9]*$" },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: "object",
      properties: {
        now: { type: "string" },
        depth: { type: "integer" },
        counts: {
          type: "object",
          properties: {
            READY: { type: "integer" },
            IN_FLIGHT: { type: "integer" },
            BACKOFF: { type: "integer" },
            RATE_LIMITED: { type: "integer" },
          },
        },
        items: { type: "array", items: queueItemSchema },
      },
    },
  },
} as const;

type QueueState = "READY" | "IN_FLIGHT" | "BACKOFF" | "RATE_LIMITED";

function deriveState(
  visibilityTimeout: Date | null,
  workerId: string | null,
  attemptCount: number,
  now: Date,
): QueueState {
  // Same visibility predicate the worker claims on.
  if (!visibilityTimeout || visibilityTimeout <= now) return "READY";
  // A worker only leaves its id on the row while it is actually processing;
  // the retry and rate-limit paths clear it.
  if (workerId) return "IN_FLIGHT";
  return attemptCount > 0 ? "BACKOFF" : "RATE_LIMITED";
}

const root: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get<{ Querystring: { limit?: string } }>(
    "/",
    { schema: listQueueSchema },
    async (request, reply) => {
      const now = new Date();
      const limit = Math.min(parsePositiveInt(request.query.limit, 50), 200);

      const [depth, rows] = await Promise.all([
        prisma.notificationQueue.count(),
        prisma.notificationQueue.findMany({
          take: limit,
          // Mirrors `claimNextJob` so the head of this list is the next job out.
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            notificationId: true,
            priority: true,
            workerId: true,
            visibilityTimeout: true,
            createdAt: true,
            notification: {
              select: {
                recipientId: true,
                channel: true,
                status: true,
                subject: true,
                body: true,
                attemptCount: true,
                maxAttempts: true,
                failureReason: true,
              },
            },
          },
        }),
      ]);

      const counts: Record<QueueState, number> = {
        READY: 0,
        IN_FLIGHT: 0,
        BACKOFF: 0,
        RATE_LIMITED: 0,
      };

      const items = rows.map((row) => {
        const { notification, ...entry } = row;
        const state = deriveState(
          entry.visibilityTimeout,
          entry.workerId,
          notification.attemptCount,
          now,
        );
        counts[state] += 1;

        const waitMs = entry.visibilityTimeout
          ? entry.visibilityTimeout.getTime() - now.getTime()
          : 0;

        return {
          ...entry,
          ...notification,
          state,
          waitSeconds: Math.max(0, Math.round(waitMs / 100) / 10),
          visibilityTimeout: entry.visibilityTimeout?.toISOString() ?? null,
          createdAt: entry.createdAt.toISOString(),
        };
      });

      return reply.send({
        now: now.toISOString(),
        depth,
        // Counts cover the returned page only, not the whole queue.
        counts,
        items,
      });
    },
  );
};

export default root;

import { FastifyPluginAsync } from "fastify";
import { NotificationStatus } from "../../generated/prisma/client";
import { prisma } from "../../plugins/prisma";
import { parsePositiveInt } from "../../utils";

const root: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get<{ Querystring: { page?: string; pageSize?: string } }>(
    "/",
    async (request, reply) => {
      const page = parsePositiveInt(request.query.page, 1);
      // Cap page size to prevent large result sets from hammering the DB.
      const pageSize = Math.min(
        parsePositiveInt(request.query.pageSize, 50),
        200,
      );
      const skip = (page - 1) * pageSize;

      // Fetch total count and page of DLQ items in parallel.
      // Include enough notification fields for the dashboard to render
      // recipient, channel, and message preview without a second request.
      const [total, items] = await Promise.all([
        prisma.deadLetterQueue.count(),
        prisma.deadLetterQueue.findMany({
          skip,
          take: pageSize,
          orderBy: { createdAt: "desc" },
          include: {
            notification: {
              select: {
                recipientId: true,
                channel: true,
                subject: true,
                body: true,
              },
            },
          },
        }),
      ]);

      return reply.send({ items, page, pageSize, total });
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/:id/requeue",
    async (request, reply) => {
      const dlqItem = await prisma.deadLetterQueue.findUnique({
        where: { id: request.params.id },
        select: { id: true, notificationId: true, requeuedAt: true },
      });

      if (!dlqItem) {
        return reply.code(404).send({ error: "DLQ item not found" });
      }

      if (dlqItem.requeuedAt) {
        return reply.code(409).send({ error: "DLQ item already requeued" });
      }

      // Requeue is a deliberate operator action after investigating the failure.
      // Reset attempt count so the notification gets a full retry cycle,
      // not just one final attempt.
      await prisma.$transaction(async (tx) => {
        await tx.notifications.update({
          where: { id: dlqItem.notificationId },
          data: {
            status: NotificationStatus.PENDING,
            attemptCount: 0,
            failureReason: null,
          },
        });

        // Insert a fresh queue row so the worker picks it up on the next poll.
        await tx.notificationQueue.create({
          data: {
            notificationId: dlqItem.notificationId,
            priority: "MEDIUM",
          },
        });

        // Stamp requeuedAt so the DLQ panel can show when this item was replayed.
        await tx.deadLetterQueue.update({
          where: { id: dlqItem.id },
          data: { requeuedAt: new Date() },
        });
      });

      return reply.send({
        requeued: true,
        notificationId: dlqItem.notificationId,
      });
    },
  );

  fastify.post("/requeue-all", async (request, reply) => {
    // Only pick up items that have not already been requeued — idempotent
    // so hitting this endpoint twice does not double-enqueue.
    const dlqItems = await prisma.deadLetterQueue.findMany({
      where: { requeuedAt: null },
      select: { id: true, notificationId: true },
    });

    if (dlqItems.length === 0) {
      return reply.send({ requeued: 0 });
    }

    const now = new Date();

    // All state changes are atomic: notifications flip to PENDING, queue rows
    // are inserted, and DLQ items are stamped — or none of it happens.
    await prisma.$transaction(async (tx) => {
      const notificationIds = dlqItems.map((item) => item.notificationId);

      await tx.notifications.updateMany({
        where: { id: { in: notificationIds } },
        data: {
          status: NotificationStatus.PENDING,
          attemptCount: 0,
          failureReason: null,
        },
      });

      // skipDuplicates guards against a queue row already existing for any
      // of these notifications (e.g. from a partial previous requeue).
      await tx.notificationQueue.createMany({
        data: notificationIds.map((id) => ({
          notificationId: id,
          priority: "MEDIUM",
        })),
        skipDuplicates: true,
      });

      await tx.deadLetterQueue.updateMany({
        where: { id: { in: dlqItems.map((item) => item.id) } },
        data: { requeuedAt: now },
      });
    });

    return reply.send({ requeued: dlqItems.length });
  });
};

export default root;

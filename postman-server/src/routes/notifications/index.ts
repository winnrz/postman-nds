import { FastifyPluginAsync } from "fastify";

import { Prisma } from "../../generated/prisma/client";
import {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
} from "../../models/enums";
import { prisma } from "../../plugins/prisma";
import {
  CreateNotificationDto,
  CreateNotificationsBatchDto,
  ListNotificationsQuery,
} from "../../models/dtos/notifications";
import { createNotification, validateNotificationForCreate } from "../../services/notifications";

// JSON Schema `enum` arrays must stay in sync with Prisma string enums on `Notifications`.
const channelValues = Object.values(NotificationChannel);
const priorityValues = Object.values(NotificationPriority);
const statusValues = Object.values(NotificationStatus);

const notificationMetadataJsonSchema = {
  type: "object",
  additionalProperties: { type: "string" },
} as const;

/** Request body for `POST /notifications` — matches `CreateNotificationDto`. */
export const createNotificationBodyJsonSchema = {
  type: "object",
  required: ["recipientId", "channel", "priority"],
  properties: {
    templateId: { type: "string" },
    recipientId: { type: "string", minLength: 1 },
    channel: { type: "string", enum: channelValues },
    priority: { type: "string", enum: priorityValues },
    subject: { type: "string" },
    body: { type: "string" },
    metadata: notificationMetadataJsonSchema,
    scheduleAt: { type: "string" },
  },
  additionalProperties: false,
} as const;

/** Query string for `GET /notifications` — matches `ListNotificationsQuery`. */
export const listNotificationsQuerystringJsonSchema = {
  type: "object",
  properties: {
    // Query params arrive as strings; patterns reject zero and non-numeric values before `parsePositiveInt`.
    page: { type: "string", pattern: "^[1-9][0-9]*$" },
    pageSize: { type: "string", pattern: "^[1-9][0-9]*$" },
    recipientId: { type: "string" },
    status: { type: "string", enum: statusValues },
    channel: { type: "string", enum: channelValues },
    priority: { type: "string", enum: priorityValues },
  },
  additionalProperties: false,
} as const;

// Mirrors the `select` below and the ISO date strings returned from the list handler.
const notificationRowJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    templateId: { type: ["string", "null"] },
    recipientId: { type: "string" },
    channel: { type: "string" },
    priority: { type: "string" },
    status: { type: "string" },
    subject: { type: ["string", "null"] },
    body: { type: ["string", "null"] },
    metadata: { type: ["object", "null"] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    attemptedAt: { type: ["string", "null"] },
    deliveredAt: { type: ["string", "null"] },
    scheduledAt: { type: ["string", "null"] },

  },
} as const;

/** Full Fastify route schema: create notification. */
export const createNotificationRouteSchema = {
  body: createNotificationBodyJsonSchema,
  response: {
    201: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string" },
      },
    },
  },
} as const;

const batchCreateNotificationsBodySchema = {
  type: "object",
  required: ["notifications"],
  properties: {
    notifications: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: createNotificationBodyJsonSchema,
    },
  },
  additionalProperties: false,
} as const;

const batchCreateNotificationResultItemSchema = {
  type: "object",
  required: ["index", "success"],
  properties: {
    index: { type: "integer", minimum: 0 },
    success: { type: "boolean" },
    id: { type: "string" },
    status: { type: "string" },
    created: { type: "boolean" },
    error: { type: "string" },
    message: { type: "string" },
    field: { type: "string" },
  },
} as const;

export const createNotificationsBatchRouteSchema = {
  body: batchCreateNotificationsBodySchema,
  response: {
    200: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: batchCreateNotificationResultItemSchema,
        },
      },
    },
  },
} as const;

/** Full Fastify route schema: list notifications. */
export const listNotificationsRouteSchema = {
  querystring: listNotificationsQuerystringJsonSchema,
  response: {
    200: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: notificationRowJsonSchema,
        },
        page: { type: "integer" },
        pageSize: { type: "integer" },
        total: { type: "integer" },
      },
    },
  },
} as const;

const notificationIdParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
} as const;

/** `GET /notifications/:id` */
export const getNotificationByIdRouteSchema = {
  params: notificationIdParamsJsonSchema,
  response: {
    200: notificationRowJsonSchema,
    404: {
      type: "object",
      properties: {
        error: { type: "string" },
      },
    },
  },
} as const;

// Coerces optional pagination query params; invalid or missing values fall back to defaults.
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Optional filters are loose strings from the querystring; this narrows them before writing Prisma `where`.
function isEnumValue<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): value is T {
  return value !== undefined && (allowed as readonly string[]).includes(value);
}


const root: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get<{ Querystring: ListNotificationsQuery }>(
    "/",
    { schema: listNotificationsRouteSchema },
    async (request, reply) => {
      const q = request.query;
      const page = parsePositiveInt(q.page, 1);
      // Cap page size so list endpoints cannot be abused for huge result sets.
      const pageSize = Math.min(
        50,
        Math.max(1, parsePositiveInt(q.pageSize, 20)),
      );
      const skip = (page - 1) * pageSize;

      const where: Prisma.NotificationsWhereInput = {};

      if (q.recipientId) {
        where.recipientId = q.recipientId;
      }
      if (isEnumValue(q.status, Object.values(NotificationStatus))) {
        where.status = q.status;
      }
      if (isEnumValue(q.channel, Object.values(NotificationChannel))) {
        where.channel = q.channel;
      }
      if (isEnumValue(q.priority, Object.values(NotificationPriority))) {
        where.priority = q.priority;
      }

      // One round-trip for total count (pagination UI) and one for the page of rows.
      const [total, rows] = await Promise.all([
        prisma.notifications.count({ where }),
        prisma.notifications.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
          select: {
            id: true,
            templateId: true,
            recipientId: true,
            channel: true,
            priority: true,
            status: true,
            subject: true,
            body: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ]);

      return reply.send({
        // Prisma returns `Date` objects; JSON responses need ISO strings to match the response schema.
        items: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        page,
        pageSize,
        total,
      });
    },
  );

  fastify.post<{ Body: CreateNotificationDto }>(
    "/",
    { schema: createNotificationRouteSchema },
    async (request, reply) => {
      const validated = await validateNotificationForCreate(request.body);
      if (!validated.ok) {
        return reply.code(validated.statusCode).send(validated.payload);
      }

      const result = await createNotification(
        request.body,
        validated.scheduledAt,
        validated.scheduledAtIso,
      );
      return reply
        .code(result.created ? 201 : 200)
        .send({ id: result.id, status: result.status });
    },
  );

  fastify.post<{ Body: CreateNotificationsBatchDto }>(
    "/batch",
    { schema: createNotificationsBatchRouteSchema },
    async (request, reply) => {
      const { notifications } = request.body;
      const results: Array<{
        index: number;
        success: boolean;
        id?: string;
        status?: string;
        created?: boolean;
        error?: string;
        message?: string;
        field?: string;
      }> = [];

      for (let index = 0; index < notifications.length; index++) {
        const item = notifications[index];
        const validated = await validateNotificationForCreate(item);
        if (!validated.ok) {
          results.push({
            index,
            success: false,
            error: validated.payload.error,
            message: validated.payload.message,
            field: validated.payload.field,
          });
          continue;
        }

        const outcome = await createNotification(
          item,
          validated.scheduledAt,
          validated.scheduledAtIso,
        );
        results.push({
          index,
          success: true,
          id: outcome.id,
          status: outcome.status,
          created: outcome.created,
        });
      }

      return reply.send({ results });
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/:id",
    { schema: getNotificationByIdRouteSchema },
    async (request, reply) => {
      const row = await prisma.notifications.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          recipientId: true,
          channel: true,
          priority: true,
          status: true,
          subject: true,
          body: true,
          metadata: true,
          templateId: true,
          attemptCount: true,
          scheduledAt: true,
          deliveredAt: true,
          failureReason: true,
          createdAt: true,
          updatedAt: true,
          attemptLogs: {
            // full attempt history
            select: {
              attemptNumber: true,
              workerId: true,
              provider: true,
              success: true,
              providerMessageId: true,
              errorCode: true,
              errorMessage: true,
              durationMs: true,
              attemptedAt: true,
            },
            orderBy: { attemptNumber: "asc" },
          },
        },
      });

      if (!row) {
        return reply.code(404).send({ error: "Notification not found" });
      }

      const { attemptLogs, ...notification } = row;

      return reply.send({
        ...notification,
        scheduledAt: row.scheduledAt?.toISOString() ?? null,
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        attempts: attemptLogs.map((a) => ({
          ...a,
          attemptedAt: a.attemptedAt.toISOString(),
        })),
      });
    },
  );
};

export default root;

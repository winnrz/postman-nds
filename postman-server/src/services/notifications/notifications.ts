import { computeNotificationIdempotencyKey, isUniqueConstraintError } from "../../lib";
import { CreateNotificationDto } from "../../models/dtos/notifications";
import { NotificationStatus } from "../../models/enums";
import { prisma } from "../../plugins/prisma";

// Duplicate submissions within this window return the existing notification.
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

type ValidateCreateOk = {
  ok: true;
  scheduledAt: Date | null;
  scheduledAtIso: string;
};

type ValidateCreateErr = {
  ok: false;
  statusCode: number;
  payload: {
    error: string;
    message?: string;
    field?: string;
  };
};

export type CreateNotificationResult =
  | { created: true; id: string; status: string }
  | { created: false; id: string; status: string };

export async function createNotification(
  body: CreateNotificationDto,
  scheduledAt: Date | null,
  scheduledAtIso: string,
): Promise<CreateNotificationResult> {
  const idempotencyKey = computeNotificationIdempotencyKey(body, scheduledAtIso);

  // Check for an existing notification with the same idempotency key before
  // attempting any write — the common case for duplicate detection.
  const existing = await prisma.notifications.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true, createdAt: true },
  });

  if (existing) {
    const ageMs = Date.now() - existing.createdAt.getTime();
    if (ageMs < IDEMPOTENCY_WINDOW_MS) {
      return { created: false, id: existing.id, status: existing.status };
    }
  }

  // Evaluate scheduled status once so the same boundary is used for both the
  // status field and the enqueue decision below.
  const isScheduled = scheduledAt !== null && scheduledAt > new Date();

  try {
    const notification = await prisma.$transaction(async (tx) => {
      const created = await tx.notifications.create({
        data: {
          idempotencyKey,
          templateId: body.templateId ?? null,
          recipientId: body.recipientId,
          channel: body.channel,
          priority: body.priority,
          subject: body.subject ?? null,
          body: body.body ?? null,
          metadata: body.metadata ?? undefined,
          scheduledAt,
          // future-dated notifications wait in SCHEDULED status;
          // everything else is PENDING and enqueued immediately below.
          status: isScheduled ? NotificationStatus.SCHEDULED : NotificationStatus.PENDING,
        },
        select: { id: true, status: true, priority: true },
      });

      // Enqueue within the same transaction so it is impossible for a
      // notification to be saved without a corresponding queue row. The scheduler
      // is responsible for enqueuing SCHEDULED notifications when their time arrives.
      if (!isScheduled) {
        await tx.notificationQueue.create({
          data: {
            notificationId: created.id,
            priority: created.priority,
          },
        });
      }

      return created;
    });

    return { created: true, id: notification.id, status: notification.status };
  } catch (err) {
    // Two concurrent requests with the same idempotency key can both pass the
    // findUnique check above if they arrive within the same millisecond. The
    // unique index on idempotencyKey rejects the second insert — treat this
    // identically to a found duplicate and return the winning row.
    if (isUniqueConstraintError(err)) {
      const winner = await prisma.notifications.findUnique({
        where: { idempotencyKey },
        select: { id: true, status: true },
      });
      if (!winner) throw new Error("Notification vanished after constraint violation");
      return { created: false, id: winner.id, status: winner.status };
    }
    throw err;
  }
}

/** Same rules as `POST /notifications` before calling `createNotification`. */
export async function validateNotificationForCreate(
  body: CreateNotificationDto,
): Promise<ValidateCreateOk | ValidateCreateErr> {
  if (body.templateId) {
    const template = await prisma.templates.findUnique({
      where: { id: body.templateId },
      select: { id: true },
    });
    if (!template) {
      return {
        ok: false,
        statusCode: 422,
        payload: {
          error: "Validation failed",
          field: "templateId",
          message: "templateId does not reference an existing template",
        },
      };
    }
  }

  const hasTemplate = Boolean(body.templateId);
  const hasBody = body.body !== undefined && body.body.trim().length > 0;
  if (!hasTemplate && !hasBody) {
    return {
      ok: false,
      statusCode: 422,
      payload: {
        error: "Validation failed",
        message:
          "Either templateId or a non-empty body is required (template-only or ad-hoc content)",
      },
    };
  }

  let scheduledAtIso = "";
  let scheduledAt: Date | null = null;
  if (body.scheduleAt !== undefined && body.scheduleAt !== "") {
    const parsed = new Date(body.scheduleAt);
    if (Number.isNaN(parsed.getTime())) {
      return {
        ok: false,
        statusCode: 422,
        payload: {
          error: "Validation failed",
          field: "scheduleAt",
          message: "scheduleAt must be a valid ISO 8601 date string",
        },
      };
    }
    scheduledAtIso = parsed.toISOString();
    scheduledAt = parsed;
  }

  return { ok: true, scheduledAt, scheduledAtIso };
}
import { computeBackoffSeconds, isPermanentFailure, parseErrorCode } from ".";
import {
  NotificationChannel,
  NotificationProvider,
  NotificationStatus,
} from "../generated/prisma/client";
import { DispatchResult } from "../models/types";
import { prisma } from "../plugins/prisma";
import sleep from "../utils/sleep";
import { emailHandler, smsHandler } from "./handlers";


const VISIBILITY_TIMEOUT_MS = 30_000;
const WORKER_ID = process.env.WORKER_ID ?? "worker-1";

type QueueJob = {
  queueId: string;
  notificationId: string;
};


// Atomically claim the next available job by setting a visibility timeout, ensuring only one worker can claim it.
async function claimNextJob(): Promise<QueueJob | null> {
  const now = new Date();
  // Pull the oldest visible job (null/expired timeout means available to claim).
  const candidate = await prisma.notificationQueue.findFirst({
    where: {
      OR: [{ visibilityTimeout: null }, { visibilityTimeout: { lt: now } }],
    },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, notificationId: true },
  });

  if (!candidate) return null;

  const claimedUntil = new Date(Date.now() + VISIBILITY_TIMEOUT_MS);
  // Atomic claim guard: only one worker can move this row into its visibility window.
  const claim = await prisma.notificationQueue.updateMany({
    where: {
      id: candidate.id,
      OR: [{ visibilityTimeout: null }, { visibilityTimeout: { lt: now } }],
    },
    data: {
      workerId: WORKER_ID,
      visibilityTimeout: claimedUntil,
    },
  });

  if (claim.count === 0) return null;

  return {
    queueId: candidate.id,
    notificationId: candidate.notificationId,
  };
}

function getProviderForChannel(channel: NotificationChannel): NotificationProvider {
  switch (channel) {
    case NotificationChannel.EMAIL:
      return NotificationProvider.SENDGRID;
    case NotificationChannel.SMS:
      return NotificationProvider.TWILIO;
  }
}

// Dispatch to the appropriate handler based on channel; handlers simulate provider interaction and return a structured result.
async function dispatch(notification: {
  id: string;
  subject: string | null;
  body: string | null;
  recipientId: string;
  idempotencyKey: string;
  channel: NotificationChannel;
}): Promise<DispatchResult> {
  if (notification.channel === NotificationChannel.EMAIL) {
    return emailHandler(notification);
  }
  if (notification.channel === NotificationChannel.SMS) {
    return smsHandler(notification);
  }
  return {
    success: false,
    providerMessageId: null,
    error: `400: Unsupported channel ${notification.channel}`,
  };
}

// Core worker logic: claim a job, attempt delivery, and handle success, retryable failure, or terminal failure with appropriate state updates and logging.
export async function processNextQueueItem(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;

  const notification = await prisma.notifications.findUnique({
    where: { id: job.notificationId },
    select: {
      id: true,
      recipientId: true,
      channel: true,
      subject: true,
      body: true,
      idempotencyKey: true,
      attemptCount: true,
      maxAttempts: true,
    },
  });

  if (!notification) {
    // Queue row can outlive the source notification; clean up stale queue entry.
    await prisma.notificationQueue.deleteMany({ where: { id: job.queueId } });
    return true;
  }

  const provider = getProviderForChannel(notification.channel);
  const attemptNumber = notification.attemptCount + 1;
  const startedAt = Date.now();
  let result: DispatchResult;

  try {
    result = await dispatch(notification);
  } catch (error) {
    result = {
      success: false,
      providerMessageId: null,
      error: error instanceof Error ? error.message : "Unknown dispatch error",
    };
  }

  const durationMs = Date.now() - startedAt;
  const now = new Date();

  if (result.success) {
    // Success path stays transactional: mark delivered, log attempt, then dequeue.
    await prisma.$transaction(async (tx) => {
      await tx.notifications.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.DELIVERED,
          deliveredAt: now,
          providerMessageId: result.providerMessageId,
          failureReason: null,
          attemptCount: attemptNumber,
        },
      });

      await tx.attemptLog.create({
        data: {
          notificationId: notification.id,
          attemptNumber,
          workerId: WORKER_ID,
          provider,
          success: true,
          providerMessageId: result.providerMessageId,
          durationMs,
        },
      });

      await tx.notificationQueue.deleteMany({ where: { id: job.queueId } });
    });

    return true;
  }

  const permanentFailure = isPermanentFailure(result);
  const reachedMaxAttempts = attemptNumber >= notification.maxAttempts;
  const shouldFail = permanentFailure || reachedMaxAttempts;

  if (shouldFail) {
    // Terminal failure path: persist failed state and move to DLQ for later inspection/replay.
    await prisma.$transaction(async (tx) => {
      await tx.notifications.update({
        where: { id: notification.id },
        data: {
          attemptCount: attemptNumber,
          status: NotificationStatus.FAILED,
          failureReason: result.error,
        },
      });

      await tx.attemptLog.create({
        data: {
          notificationId: notification.id,
          attemptNumber,
          workerId: WORKER_ID,
          provider,
          success: false,
          providerMessageId: result.providerMessageId,
          errorCode: parseErrorCode(result.error),
          errorMessage: result.error,
          durationMs,
        },
      });

      await tx.deadLetterQueue.upsert({
        where: { notificationId: notification.id },
        create: {
          notificationId: notification.id,
          failureReason: result.error ?? "Unknown failure",
          attemptCount: attemptNumber,
          finalAttemptTime: now,
          errorCode: parseErrorCode(result.error),
          errorMessage: result.error,
        },
        update: {
          failureReason: result.error ?? "Unknown failure",
          attemptCount: attemptNumber,
          finalAttemptTime: now,
          errorCode: parseErrorCode(result.error),
          errorMessage: result.error,
        },
      });

      await tx.notificationQueue.deleteMany({ where: { id: job.queueId } });
    });

    return true;
  }

  const backoffSeconds = computeBackoffSeconds(attemptNumber);
  const nextVisibleAt = new Date(Date.now() + backoffSeconds * 1000);

  // Retry path: record failed attempt and postpone visibility for the next worker poll.
  await prisma.$transaction(async (tx) => {
    await tx.notifications.update({
      where: { id: notification.id },
      data: {
        attemptCount: attemptNumber,
        status: NotificationStatus.PENDING,
        failureReason: result.error,
      },
    });

    await tx.attemptLog.create({
      data: {
        notificationId: notification.id,
        attemptNumber,
        workerId: WORKER_ID,
        provider,
        success: false,
        providerMessageId: result.providerMessageId,
        errorCode: parseErrorCode(result.error),
        errorMessage: result.error,
        durationMs,
      },
    });

    await tx.notificationQueue.update({
      where: { id: job.queueId },
      data: {
        workerId: WORKER_ID,
        visibilityTimeout: nextVisibleAt,
      },
    });
  });

  return true;
}

export async function runWorkerLoop(intervalMs = 1000): Promise<void> {
  // Fire-and-forget poller; failures are logged and do not stop the loop.
  while (true) {
    await processNextQueueItem().catch((error) => {
      // eslint-disable-next-line no-console
      console.error("[worker] processNextQueueItem failed", error);
    });

    await sleep(intervalMs);
  }
}


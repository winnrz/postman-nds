-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SCHEDULED', 'PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationProvider" AS ENUM ('SENDGRID', 'MAILGUN', 'TWILIO', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'IN_APP');

-- CreateTable
CREATE TABLE "Notifications" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "recipientId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "subject" TEXT,
    "body" TEXT,
    "metadata" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "scheduledAt" TIMESTAMP(3),
    "enqueuedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationQueue" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'MEDIUM',
    "workerId" TEXT,
    "visibilityTimeout" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptLog" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workerId" TEXT NOT NULL,
    "provider" "NotificationProvider",
    "success" BOOLEAN NOT NULL,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,

    CONSTRAINT "AttemptLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadLetterQueue" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "failureReason" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL,
    "finalAttemptTime" TIMESTAMP(3) NOT NULL,
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "requeuedBy" TEXT,
    "requeuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadLetterQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InAppNotifications" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InAppNotifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "channel" "NotificationChannel" NOT NULL,
    "subjectTemplate" TEXT,
    "bodyTemplate" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKeys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notifications_idempotencyKey_key" ON "Notifications"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Notifications_recipientId_idx" ON "Notifications"("recipientId");

-- CreateIndex
CREATE INDEX "Notifications_status_idx" ON "Notifications"("status");

-- CreateIndex
CREATE INDEX "Notifications_status_priority_createdAt_idx" ON "Notifications"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "Notifications_status_scheduledAt_idx" ON "Notifications"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationQueue_notificationId_key" ON "NotificationQueue"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationQueue_priority_createdAt_idx" ON "NotificationQueue"("priority", "createdAt");

-- CreateIndex
CREATE INDEX "AttemptLog_notificationId_attemptNumber_idx" ON "AttemptLog"("notificationId", "attemptNumber");

-- CreateIndex
CREATE INDEX "AttemptLog_notificationId_idx" ON "AttemptLog"("notificationId");

-- CreateIndex
CREATE INDEX "AttemptLog_workerId_idx" ON "AttemptLog"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "DeadLetterQueue_notificationId_key" ON "DeadLetterQueue"("notificationId");

-- CreateIndex
CREATE INDEX "DeadLetterQueue_notificationId_idx" ON "DeadLetterQueue"("notificationId");

-- CreateIndex
CREATE INDEX "DeadLetterQueue_createdAt_idx" ON "DeadLetterQueue"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InAppNotifications_notificationId_key" ON "InAppNotifications"("notificationId");

-- CreateIndex
CREATE INDEX "InAppNotifications_recipientId_createdAt_idx" ON "InAppNotifications"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "InAppNotifications_recipientId_read_createdAt_idx" ON "InAppNotifications"("recipientId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "Templates_key_isActive_idx" ON "Templates"("key", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Templates_key_version_key" ON "Templates"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeys_keyHash_key" ON "ApiKeys"("keyHash");

-- AddForeignKey
ALTER TABLE "Notifications" ADD CONSTRAINT "Notifications_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationQueue" ADD CONSTRAINT "NotificationQueue_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptLog" ADD CONSTRAINT "AttemptLog_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadLetterQueue" ADD CONSTRAINT "DeadLetterQueue_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotifications" ADD CONSTRAINT "InAppNotifications_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

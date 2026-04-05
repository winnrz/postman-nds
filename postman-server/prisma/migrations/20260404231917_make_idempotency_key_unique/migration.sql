/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `Notifications` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Notifications_idempotencyKey_key" ON "Notifications"("idempotencyKey");

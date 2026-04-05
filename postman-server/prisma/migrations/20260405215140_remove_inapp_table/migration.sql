/*
  Warnings:

  - The values [IN_APP] on the enum `NotificationChannel` will be removed. If these variants are still used in the database, this will fail.
  - The values [IN_APP] on the enum `NotificationProvider` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `InAppNotifications` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "NotificationChannel_new" AS ENUM ('EMAIL', 'SMS');
ALTER TABLE "Notifications" ALTER COLUMN "channel" TYPE "NotificationChannel_new" USING ("channel"::text::"NotificationChannel_new");
ALTER TABLE "Templates" ALTER COLUMN "channel" TYPE "NotificationChannel_new" USING ("channel"::text::"NotificationChannel_new");
ALTER TYPE "NotificationChannel" RENAME TO "NotificationChannel_old";
ALTER TYPE "NotificationChannel_new" RENAME TO "NotificationChannel";
DROP TYPE "public"."NotificationChannel_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationProvider_new" AS ENUM ('SENDGRID', 'MAILGUN', 'TWILIO');
ALTER TABLE "AttemptLog" ALTER COLUMN "provider" TYPE "NotificationProvider_new" USING ("provider"::text::"NotificationProvider_new");
ALTER TYPE "NotificationProvider" RENAME TO "NotificationProvider_old";
ALTER TYPE "NotificationProvider_new" RENAME TO "NotificationProvider";
DROP TYPE "public"."NotificationProvider_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "InAppNotifications" DROP CONSTRAINT "InAppNotifications_notificationId_fkey";

-- DropTable
DROP TABLE "InAppNotifications";

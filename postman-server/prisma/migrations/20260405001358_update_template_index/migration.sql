/*
  Warnings:

  - You are about to drop the column `key` on the `Templates` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name,channel]` on the table `Templates` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Templates_key_isActive_idx";

-- DropIndex
DROP INDEX "Templates_key_version_key";

-- AlterTable
ALTER TABLE "Templates" DROP COLUMN "key";

-- CreateIndex
CREATE INDEX "Templates_channel_isActive_idx" ON "Templates"("channel", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Templates_name_channel_key" ON "Templates"("name", "channel");

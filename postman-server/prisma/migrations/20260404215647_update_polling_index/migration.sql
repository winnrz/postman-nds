-- This is an empty migration.
CREATE INDEX ON "NotificationQueue" (priority DESC, "createdAt" ASC)
  WHERE "visibilityTimeout" IS NULL;
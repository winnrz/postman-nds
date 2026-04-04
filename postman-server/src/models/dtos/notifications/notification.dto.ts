import { NotificationChannel, NotificationPriority, NotificationStatus } from "../../enums/enums";

// Arbitrary JSON-safe metadata stored with the notification (provider-specific fields, etc.).
export type NotificationMetadata = Record<string, unknown>;

export interface CreateNotificationDto {
  templateId?: string;
  recipientId: string;
  channel: NotificationChannel;
  priority?: NotificationPriority;
  status?: NotificationStatus;
  subject?: string;
  body?: string;
  metadata?: NotificationMetadata;
  /** Dedupes creates; must match the unique `idempotencyKey` column on `Notifications`. */
  idempotencyKey: string;
  maxAttempts?: number;
  scheduledAt?: string | Date;
}

export interface CreateNotificationsBatchDto {
  notifications: CreateNotificationDto[];
}

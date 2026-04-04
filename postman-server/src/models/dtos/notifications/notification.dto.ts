import { NotificationChannel, NotificationPriority } from "../../enums/enums";

// Arbitrary JSON-safe metadata stored with the notification (provider-specific fields, etc.).
export type NotificationMetadata = Record<string, string>;

export interface CreateNotificationDto {
  templateId?: string;
  recipientId: string;
  channel: NotificationChannel;
  priority: NotificationPriority;
  subject?: string;
  body?: string;
  metadata?: NotificationMetadata;
}

export interface CreateNotificationsBatchDto {
  notifications: CreateNotificationDto[];
}

/** Query string for `GET /notifications` (values are strings as sent over HTTP). */
export interface ListNotificationsQuery {
  page?: string;
  pageSize?: string;
  recipientId?: string;
  status?: string;
  channel?: string;
  priority?: string;
}

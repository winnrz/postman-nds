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

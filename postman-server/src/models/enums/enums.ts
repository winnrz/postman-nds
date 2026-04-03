// Mirrors Prisma enums in `schema.prisma` for shared use in DTOs and JSON Schema.

export enum NotificationPriority {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

export enum NotificationStatus {
  SCHEDULED = "SCHEDULED",
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  DELIVERED = "DELIVERED",
  FAILED = "FAILED",
}

export enum NotificationChannel {
  EMAIL = "EMAIL",
  SMS = "SMS",
  IN_APP = "IN_APP",
}
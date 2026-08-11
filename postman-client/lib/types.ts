export type Channel = "EMAIL" | "SMS";
export type Priority = "LOW" | "MEDIUM" | "HIGH";
export type Status =
  | "SCHEDULED"
  | "PENDING"
  | "PROCESSING"
  | "DELIVERED"
  | "FAILED";

/** Derived server-side in `GET /queue` from the row's visibility window. */
export type QueueState = "READY" | "IN_FLIGHT" | "BACKOFF" | "RATE_LIMITED";

export type Notification = {
  id: string;
  templateId: string | null;
  recipientId: string;
  channel: Channel;
  priority: Priority;
  status: Status;
  subject: string | null;
  body: string | null;
  metadata: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
};

export type Attempt = {
  attemptNumber: number;
  workerId: string;
  provider: string | null;
  success: boolean;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  attemptedAt: string;
};

export type NotificationDetail = Notification & {
  attemptCount: number;
  maxAttempts: number;
  failureReason: string | null;
  scheduledAt: string | null;
  deliveredAt: string | null;
  attempts: Attempt[];
};

export type QueueItem = {
  id: string;
  notificationId: string;
  priority: Priority;
  state: QueueState;
  workerId: string | null;
  visibilityTimeout: string | null;
  waitSeconds: number;
  createdAt: string;
  recipientId: string;
  channel: Channel;
  status: Status;
  subject: string | null;
  body: string | null;
  attemptCount: number;
  maxAttempts: number;
  failureReason: string | null;
};

export type QueueSnapshot = {
  now: string;
  depth: number;
  counts: Record<QueueState, number>;
  items: QueueItem[];
};

export type Metrics = {
  timestamp: string;
  queue: { depth: number; visibleDepth: number };
  workers: { activeCount: number };
  sendRates: {
    successfulAttempts: number;
    byProvider: Record<string, number>;
  };
  throughput: { last1h: number; last24h: number; last7d: number };
  failureRate: {
    totalAttempts: number;
    failedAttempts: number;
    failureRatio: number;
  };
  rateLimiter: Record<
    string,
    { tokens: number; limit: number; available: boolean }
  >;
};

export type Template = {
  id: string;
  name: string;
  channel: Channel;
  subjectTemplate: string | null;
  bodyTemplate: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DlqItem = {
  id: string;
  notificationId: string;
  failureReason: string;
  attemptCount: number;
  finalAttemptTime: string;
  errorMessage: string | null;
  errorCode: string | null;
  requeuedBy: string | null;
  requeuedAt: string | null;
  createdAt: string;
  notification: {
    recipientId: string;
    channel: Channel;
    subject: string | null;
    body: string | null;
  };
};

/** Where a notification sits in the pipeline, merged from notification + queue state. */
export type Stage =
  | "SCHEDULED"
  | "QUEUED"
  | "RATE_LIMITED"
  | "IN_FLIGHT"
  | "BACKOFF"
  | "DELIVERED"
  | "DLQ";

export type TrackedNotification = Notification & {
  stage: Stage;
  attemptCount: number;
  maxAttempts: number;
  workerId: string | null;
  waitSeconds: number;
  failureReason: string | null;
};

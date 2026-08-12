import type {
  DlqItem,
  Metrics,
  Notification,
  NotificationDetail,
  QueueSnapshot,
  Template,
} from "./types";

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

// The browser talks to the API directly rather than through a Next.js route, so
// the origin has to be public. `NEXT_PUBLIC_` values are inlined by `next build`
// — this is fixed at build time, not read at runtime, so it must be set in the
// hosting project's environment before the build runs.
const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const record = payload as Record<string, unknown> | null;
    const message =
      (typeof record?.message === "string" && record.message) ||
      (typeof record?.error === "string" && record.error) ||
      `${response.status} ${response.statusText}`;
    throw new ApiError(response.status, payload, message);
  }

  return payload as T;
}

export type CreateNotificationInput = {
  templateId?: string;
  recipientId: string;
  channel: string;
  priority: string;
  subject?: string;
  body?: string;
  metadata?: Record<string, string>;
  scheduleAt?: string;
};

/** `created: false` means the idempotency key matched an existing notification. */
export type CreateNotificationResponse = { id: string; status: string };

export type BatchResult = {
  index: number;
  success: boolean;
  id?: string;
  status?: string;
  created?: boolean;
  error?: string;
  message?: string;
  field?: string;
};

export const api = {
  metrics: () => request<Metrics>("/metrics"),

  queue: (limit = 200) => request<QueueSnapshot>(`/queue?limit=${limit}`),

  notifications: (pageSize = 60) =>
    request<{ items: Notification[]; total: number }>(
      `/notifications?pageSize=${pageSize}`,
    ),

  notification: (id: string) =>
    request<NotificationDetail>(`/notifications/${id}`),

  dlq: (pageSize = 50) =>
    request<{ items: DlqItem[]; total: number }>(`/dlq?pageSize=${pageSize}`),

  // Read-only: the demo sends from one seeded template and the client never
  // creates one. `POST /templates` is admin-gated on the server regardless.
  templates: () => request<Template[]>("/templates"),

  // 201 = a new row; 200 = the idempotency key matched something recent.
  createNotification: async (input: CreateNotificationInput) => {
    const response = await fetch(apiUrl("/notifications"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new ApiError(
        response.status,
        payload,
        payload?.message ?? payload?.error ?? "Request failed",
      );
    }
    return {
      ...(payload as CreateNotificationResponse),
      deduplicated: response.status === 200,
    };
  },

  createBatch: (notifications: CreateNotificationInput[]) =>
    request<{ results: BatchResult[] }>("/notifications/batch", {
      method: "POST",
      body: JSON.stringify({ notifications }),
    }),

  requeue: (id: string) =>
    request<{ requeued: boolean; notificationId: string }>(
      `/dlq/${id}/requeue`,
      { method: "POST" },
    ),

  requeueAll: () =>
    request<{ requeued: number }>("/dlq/requeue-all", { method: "POST" }),
};

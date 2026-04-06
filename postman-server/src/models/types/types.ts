export type DispatchResult = {
  success: boolean;
  providerMessageId: string | null;
  error: string | null;
};

export type QueueJob = {
  queueId: string;
  notificationId: string;
};
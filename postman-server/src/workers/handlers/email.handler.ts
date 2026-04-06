import { DispatchResult } from "../../models/types";


export async function emailHandler(notification: {
  id: string;
  subject: string | null;
  body: string | null;
  recipientId: string;
  idempotencyKey: string;
}): Promise<DispatchResult> {
  await sleep(200); // simulate SendGrid latency

  // Simulate occasional failures for retry/backoff/DLQ 
  const roll = Math.random();

  if (roll < 0.1) {
    // 10% chance — permanent failure (4xx), goes straight to DLQ
    return {
      success: false,
      providerMessageId: null,
      error: "400: Invalid recipient address",
    };
  }

  if (roll < 0.25) {
    // 15% chance — transient failure (5xx), will retry with backoff
    return {
      success: false,
      providerMessageId: null,
      error: "503: SendGrid unavailable",
    };
  }

  // 75% success
  return {
    success: true,
    providerMessageId: `stub_sg_${crypto.randomUUID()}`,
    error: null,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
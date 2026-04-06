import { DispatchResult } from "../models/types";

const MAX_BACKOFF_SECONDS = parseInt(process.env.MAX_BACKOFF_SECONDS ?? "300");


export function parseErrorCode(error: string | null): string | null {
  if (!error) return null;
  const [firstToken] = error.split(":");
  return /^\d{3}$/.test(firstToken.trim()) ? firstToken.trim() : null;
}

export function isPermanentFailure(result: DispatchResult): boolean {
  // Treat 4xx-like provider failures as non-retryable except for 429 rate limits, which are transient and should be retried with backoff.
  const code = parseErrorCode(result.error);
  if (!code) return false;
  return code.startsWith("4") && code !== "429";
}

export function computeBackoffSeconds(attemptNumber: number): number {
  // Exponential retry with cap to avoid unbounded queue delays. Add some random jitter to prevent thundering herd retries.
  const base = 30;
  const exp = Math.pow(2, attemptNumber - 1);
  const jitter = Math.random() * 0.1;
  return Math.min(MAX_BACKOFF_SECONDS, base * exp * (1 + jitter));
}
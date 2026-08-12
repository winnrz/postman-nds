import { connectRedis, redis } from "../plugins/redis";
import { withTimeout } from "./withTimeout";

// This sits on the request path, so it must fail fast rather than wait out a
// dead Redis — see `withTimeout` for why the underlying call can hang forever.
const LIMITER_TIMEOUT_MS = Number(process.env.LIMITER_TIMEOUT_MS ?? 1000);

/**
 * Per-caller request limiting for the public API — distinct from
 * `workers/rateLimiter.ts`, which paces dispatch to providers. This one exists
 * because the API is unauthenticated: without it, anyone can write rows for as
 * long as they care to.
 */

// Fixed window rather than the workers' token bucket: a burst of 20 from the
// dashboard's batch button should pass, and a fixed window forgives that as long
// as the per-minute total stays sane.
const FIXED_WINDOW_SCRIPT = `
  local key = KEYS[1]
  local window = tonumber(ARGV[1])

  local current = redis.call('INCR', key)
  -- Only the request that opens the window sets its expiry, so the window is
  -- anchored to the first request rather than sliding forward on every hit.
  if current == 1 then
    redis.call('EXPIRE', key, window)
  end

  local ttl = redis.call('TTL', key)
  return { current, ttl }
`;

export type RateLimitVerdict = {
  allowed: boolean;
  current: number;
  limit: number;
  retryAfterSeconds: number;
};

export async function consumeRequestToken(
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitVerdict> {
  const key = `req_limit:${identifier}`;

  const result = (await withTimeout(
    (async () => {
      await connectRedis();
      return redis.eval(FIXED_WINDOW_SCRIPT, {
        keys: [key],
        arguments: [String(windowSeconds)],
      });
    })(),
    LIMITER_TIMEOUT_MS,
    "write rate limiter",
  )) as [number, number];

  const [current, ttl] = result;

  return {
    allowed: current <= limit,
    current,
    limit,
    // A -1 TTL means the key exists without an expiry, which should not happen;
    // fall back to the full window rather than advertising a nonsense value.
    retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
  };
}

import { connectRedis, redis } from "../plugins/redis";

// Per-channel dispatch limits. Configurable because the demo turns on them: the
// dashboard bursts more messages than the SMS bucket holds so the overflow is
// visibly parked in RATE_LIMITED, and tuning that is how you tune the demo.
const RATE_LIMITS: Record<string, number> = {
  email: Number(process.env.RATE_LIMIT_EMAIL ?? 100),
  sms: Number(process.env.RATE_LIMIT_SMS ?? 20),
};

// How long a drained bucket takes to come back — the wait you watch during a burst.
const REFILL_INTERVAL_SECONDS = Number(
  process.env.RATE_LIMIT_REFILL_SECONDS ?? 60,
);

// Lua script that atomically:
// 1. Calculates tokens to add since last refill
// 2. Tops up the bucket without exceeding the max
// 3. Checks if a token is available
// 4. Decrements and returns 1 if yes, returns 0 if no
const TOKEN_BUCKET_SCRIPT = `
  local key = KEYS[1]
  local max_tokens = tonumber(ARGV[1])
  local refill_interval = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])

  -- Read current bucket state
  local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
  local tokens = tonumber(bucket[1]) or max_tokens
  local last_refill = tonumber(bucket[2]) or now

  -- Calculate how many tokens to add based on time elapsed
  local elapsed = now - last_refill
  local refill_count = math.floor(elapsed / refill_interval)

  if refill_count > 0 then
    tokens = math.min(max_tokens, tokens + (refill_count * max_tokens))
    last_refill = now
  end

  -- Attempt to consume a token
  if tokens > 0 then
    tokens = tokens - 1
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
    return 1
  end

  -- No tokens available — update refill timestamp but don't consume
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
  return 0
`;

export async function acquireRateLimitToken(channel: string): Promise<boolean> {
  const limit = RATE_LIMITS[channel.toLowerCase()];

  // Channels with no configured limit (e.g. in_app) are always allowed through.
  if (!limit) return true;

  const key = `rate_limit:${channel.toLowerCase()}`;
  const now = Math.floor(Date.now() / 1000);

  await connectRedis();
  const result = await redis.eval(TOKEN_BUCKET_SCRIPT, {
    keys: [key],
    arguments: [String(limit), String(REFILL_INTERVAL_SECONDS), String(now)],
  });

  return result === 1;
}

export type RateLimitState = Record<
  string,
  { tokens: number; limit: number; available: boolean }
>;

export async function getRateLimitState(): Promise<RateLimitState> {
  // Used by the metrics endpoint to expose current token counts per channel.
  // Redis being down must not take the metrics endpoint with it — the dashboard
  // still needs queue and worker numbers, so buckets report `available: false`.
  const state: RateLimitState = {};

  let reachable = true;
  try {
    await connectRedis();
  } catch (error) {
    reachable = false;
    // eslint-disable-next-line no-console
    console.error("[rateLimiter] redis unreachable for state read", error);
  }

  for (const [channel, limit] of Object.entries(RATE_LIMITS)) {
    if (!reachable) {
      state[channel] = { tokens: 0, limit, available: false };
      continue;
    }

    const key = `rate_limit:${channel}`;
    const bucket = await redis.hGetAll(key);
    state[channel] = {
      // An untouched bucket is implicitly full — the Lua script seeds it on first use.
      tokens: bucket.tokens ? parseInt(bucket.tokens) : limit,
      limit,
      available: true,
    };
  }

  return state;
}
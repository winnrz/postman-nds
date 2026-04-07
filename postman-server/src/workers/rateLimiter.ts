import { redis } from "../plugins/redis";

// Default rate limits per channel.
const RATE_LIMITS: Record<string, number> = {
  email: 100,
  sms: 20,
};

const REFILL_INTERVAL_SECONDS = 60;

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

  const result = await redis.eval(TOKEN_BUCKET_SCRIPT, {
    keys: [key],
    arguments: [String(limit), String(REFILL_INTERVAL_SECONDS), String(now)],
  });

  return result === 1;
}

export async function getRateLimitState(): Promise<Record<string, { tokens: number; limit: number }>> {
  // Used by the metrics endpoint to expose current token counts per channel.
  const state: Record<string, { tokens: number; limit: number }> = {};

  for (const [channel, limit] of Object.entries(RATE_LIMITS)) {
    const key = `rate_limit:${channel}`;
    const bucket = await redis.hGetAll(key);
    state[channel] = {
      tokens: bucket.tokens ? parseInt(bucket.tokens) : limit,
      limit,
    };
  }

  return state;
}
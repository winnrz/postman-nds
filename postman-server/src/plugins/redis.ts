import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL

export const redis = createClient({ url: redisUrl });

redis.on("error", (error) => {
  console.error("[redis] client error", error);
});

redis.on("connect", () => {
  console.info("[redis] connected");
});

redis.on("reconnecting", () => {
  console.warn("[redis] reconnecting...");
});

// Memoised so every process (api, worker, scheduler) connects lazily on first
// use. Nothing calls connect() at boot, and redis v5 throws ClientClosedError
// on commands issued before connect resolves.
let connecting: Promise<void> | null = null;

export async function connectRedis(): Promise<void> {
  if (redis.isOpen) return;
  if (!connecting) {
    connecting = redis.connect().then(
      () => undefined,
      (error) => {
        // Allow a later call to retry instead of latching onto a rejected promise.
        connecting = null;
        throw error;
      },
    );
  }
  await connecting;
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
}
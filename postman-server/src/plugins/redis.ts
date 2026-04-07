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

export async function connectRedis(): Promise<void> {
  await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
}
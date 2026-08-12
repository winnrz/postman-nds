import { FastifyPluginAsync } from "fastify";

import { withTimeout } from "../../lib/withTimeout";
import { prisma } from "../../plugins/prisma";
import { connectRedis, redis } from "../../plugins/redis";

type DependencyState = {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
};

const healthResponseJsonSchema = {
  type: "object",
  properties: {
    status: { type: "string" },
    uptimeSeconds: { type: "integer" },
    dependencies: {
      type: "object",
      properties: {
        postgres: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            latencyMs: { type: ["integer", "null"] },
            error: { type: ["string", "null"] },
          },
        },
        redis: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            latencyMs: { type: ["integer", "null"] },
            error: { type: ["string", "null"] },
          },
        },
      },
    },
  },
} as const;

// Without a bound here the health check hangs instead of answering, which reads
// to a platform health probe as a timeout — and a deploy that never goes live.
const PROBE_TIMEOUT_MS = Number(process.env.HEALTH_PROBE_TIMEOUT_MS ?? 2000);

async function probe(run: () => Promise<unknown>): Promise<DependencyState> {
  const startedAt = Date.now();
  try {
    await withTimeout(Promise.resolve(run()), PROBE_TIMEOUT_MS, "probe");
    return { ok: true, latencyMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

const health: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get(
    "/",
    { schema: { response: { 200: healthResponseJsonSchema, 503: healthResponseJsonSchema } } },
    async function (request, reply) {
      const [postgres, redisState] = await Promise.all([
        probe(() => prisma.$queryRaw`SELECT 1`),
        probe(async () => {
          await connectRedis();
          return redis.ping();
        }),
      ]);

      // Postgres is the queue itself — without it the API can do nothing, so it
      // decides the status code. Redis only gates dispatch: the dashboard still
      // reads fine without it, and restarting the API would not bring it back,
      // so a Redis outage is reported as `degraded` rather than failing the
      // health check and taking the API down with it.
      const status = postgres.ok
        ? redisState.ok
          ? "ok"
          : "degraded"
        : "unhealthy";

      return reply.code(postgres.ok ? 200 : 503).send({
        status,
        uptimeSeconds: Math.floor(process.uptime()),
        dependencies: { postgres, redis: redisState },
      });
    },
  );
};

export default health;

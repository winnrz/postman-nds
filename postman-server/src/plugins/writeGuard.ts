import { createHash, timingSafeEqual } from "node:crypto";
import fp from "fastify-plugin";
import { FastifyReply, FastifyRequest } from "fastify";

import { consumeRequestToken } from "../lib/requestLimiter";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Writes per IP per window. The dashboard's "burst 20" button sends a single
// batch request, so ordinary use is nowhere near this.
const WRITE_LIMIT = Number(process.env.WRITE_RATE_LIMIT ?? 30);
const WINDOW_SECONDS = Number(process.env.WRITE_RATE_WINDOW_SECONDS ?? 60);

/**
 * Routes that change state beyond the caller's own submission. Creating a
 * template is durable shared state, and requeue-all moves every dead-lettered
 * row at once — neither belongs in an anonymous visitor's hands, while sending
 * a notification is the whole point of the demo and stays open.
 */
const ADMIN_ROUTES = new Set(["POST /templates", "POST /dlq/requeue-all"]);

function isAuthorizedAdmin(request: FastifyRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;

  if (!expected) {
    // Refusing outright in production is the safe default: an unset token there
    // is a misconfiguration, not permission to open the route to everyone.
    return process.env.NODE_ENV !== "production";
  }

  const presented = request.headers["x-admin-token"];
  if (typeof presented !== "string" || presented.length === 0) return false;

  // Hash both sides first so timingSafeEqual always gets equal-length buffers —
  // it throws otherwise, and the throw itself would leak the expected length.
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export default fp(async (fastify) => {
  if (!process.env.ADMIN_TOKEN && process.env.NODE_ENV === "production") {
    fastify.log.warn(
      "[writeGuard] ADMIN_TOKEN unset in production — admin routes will refuse every request",
    );
  }

  fastify.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!MUTATING_METHODS.has(request.method)) return;

      const routeKey = `${request.method} ${request.routeOptions?.url ?? ""}`;

      if (ADMIN_ROUTES.has(routeKey) && !isAuthorizedAdmin(request)) {
        return reply.code(401).send({
          error: "Unauthorized",
          message:
            "This route requires an admin token. Send it as the x-admin-token header.",
        });
      }

      // `request.ip` is only the real caller when trustProxy is on — behind
      // Railway's edge every request otherwise shares the proxy's address, which
      // would turn this per-IP limit into a single global one.
      const verdict = await consumeRequestToken(
        request.ip,
        WRITE_LIMIT,
        WINDOW_SECONDS,
      ).catch((error) => {
        // Redis being down must not close the API. Dispatch is already halted in
        // that state, so the exposure is a short window of unlimited writes
        // rather than an outage on top of an outage.
        fastify.log.error({ err: error }, "[writeGuard] limiter unavailable");
        return null;
      });

      if (!verdict) return;

      reply.header("x-ratelimit-limit", String(verdict.limit));
      reply.header(
        "x-ratelimit-remaining",
        String(Math.max(0, verdict.limit - verdict.current)),
      );

      if (!verdict.allowed) {
        reply.header("retry-after", String(verdict.retryAfterSeconds));
        return reply.code(429).send({
          error: "Too Many Requests",
          message: `Write limit of ${verdict.limit} per ${WINDOW_SECONDS}s exceeded. Retry in ${verdict.retryAfterSeconds}s.`,
        });
      }
    },
  );
});

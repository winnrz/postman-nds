import fp from "fastify-plugin";
import cors from "@fastify/cors";

// The dashboard is served from a different origin in production (Vercel) than
// the API (Railway), so the browser calls it cross-origin. Locally the two are
// localhost:4000 and localhost:3000 — also cross-origin, hence the default.
const DEFAULT_ORIGINS = ["http://localhost:4000"];

/**
 * Entries may contain `*`. Vercel mints a fresh origin for every deployment
 * (`postman-a9w4hx7s1-<team>.vercel.app`), so an exact list goes stale the next
 * time anyone clicks "Visit" on a build.
 *
 * `*` matches within a single label only — it cannot span `.` or `/` — so
 * `https://postman-*-team.vercel.app` will not match a lookalike host like
 * `https://postman-x-team.vercel.app.evil.com`.
 */
function toMatcher(entry: string): string | RegExp {
  if (!entry.includes("*")) return entry;

  const pattern = entry
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^./]*");

  return new RegExp(`^${pattern}$`);
}

// Comma-separated so preview deployments can be allowed alongside production:
//   CORS_ORIGIN=https://app.vercel.app,https://app-*-team.vercel.app
function allowedOrigins(): (string | RegExp)[] {
  const configured = process.env.CORS_ORIGIN;
  if (!configured) return DEFAULT_ORIGINS;

  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(toMatcher);
}

export default fp(async (fastify) => {
  const origins = allowedOrigins();

  if (!process.env.CORS_ORIGIN) {
    fastify.log.warn(
      `[cors] CORS_ORIGIN not set — allowing ${DEFAULT_ORIGINS.join(", ")} only`,
    );
  }

  await fastify.register(cors, {
    origin: origins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    // No cookies or Authorization header in play, so credentials stay off —
    // that also keeps the allow-list from having to be exact-match strict.
    credentials: false,
  });
});

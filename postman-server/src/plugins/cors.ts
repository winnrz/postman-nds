import fp from "fastify-plugin";
import cors from "@fastify/cors";

// The dashboard is served from a different origin in production (Vercel) than
// the API (Railway), so the browser calls it cross-origin. Locally the two are
// localhost:4000 and localhost:3000 — also cross-origin, hence the default.
const DEFAULT_ORIGINS = ["http://localhost:4000"];

// Comma-separated so a preview deployment can be allowed alongside production:
//   CORS_ORIGIN=https://pulse.vercel.app,https://pulse-git-x.vercel.app
function allowedOrigins(): string[] {
  const configured = process.env.CORS_ORIGIN;
  if (!configured) return DEFAULT_ORIGINS;

  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
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

# postman-nds
A notification dispatch system that accepts notification requests via a REST API, queues them durably, and delivers them reliably across multiple channels. 

# Pulse — Notification Dispatch System

A production-style **notification dispatch system** designed to demonstrate real-world backend engineering patterns: durable job queues, idempotent processing, retries with backoff, rate limiting, and provider failover.

---

## 🚀 Overview

Pulse is a REST-driven system that:

- Accepts notification requests via API
- Queues them durably using Postgres
- Dispatches them reliably across multiple channels
- Handles failures gracefully with retries and a dead letter queue

It is designed as a **portfolio-grade distributed system** with strong emphasis on correctness, observability, and resilience.

---

## ✨ Features

### Core Capabilities

- ✅ Durable job queue using Postgres (`SELECT FOR UPDATE SKIP LOCKED`)
- ✅ At-least-once delivery semantics
- ✅ Idempotent notification dispatch
- ✅ Exponential backoff with jitter
- ✅ Dead Letter Queue (DLQ) for failed jobs
- ✅ Scheduled notifications
- ✅ Provider failover (SendGrid → Mailgun)
- ✅ Rate limiting via Redis token bucket
- ✅ Worker + scheduler architecture
- ✅ Metrics & observability endpoints

---

## 📡 Supported Channels

- **Email**
  - Primary: SendGrid
  - Fallback: Mailgun
- **SMS**
  - Twilio

---

## 🏗️ Architecture

### Components

- **API Server (Fastify)**
  - Handles request validation, submission, and querying
- **Worker**
  - Polls queue, processes jobs, handles retries
- **Scheduler**
  - Moves scheduled jobs into the queue
- **Postgres**
  - Primary datastore + queue
- **Redis**
  - Rate limiting (token bucket)
- **Dashboard (optional frontend)**

---

## ⚙️ Tech Stack

- Node.js + Fastify
- Prisma ORM
- PostgreSQL
- Redis
- Docker / Docker Compose
- Postman (API testing + collections)

---

## 📦 Project Structure (High Level)

```
postman-server/      Fastify API, worker, scheduler, Prisma schema
  src/routes/        notifications, templates, queue, dlq, metrics
  src/workers/       claim → dispatch → retry/DLQ, Redis token bucket
  src/scheduler/     advisory-locked promotion of due notifications
postman-client/      Next.js dashboard (the live pipeline view)
postman/             Postman collections and environments
```

---

## 🖥️ Dashboard

`postman-client` is a live console for the pipeline. It polls the read
endpoints once a second — the same way the workers and scheduler observe the
queue — and merges them into one picture:

This is a demonstration of message movement, not a product. There is no
authoring UI: content comes from a single seeded template and the client cannot
create one. The dashboard is four things:

- **Send** — "Send one" or "Burst 25". That is the entire input surface
- **Pipeline** — API → Postgres → scheduler → queue → workers → dispatch, with
  every notification rendered as a chip in whichever stage currently holds it,
  including delivered, waiting out backoff, rate limited, and dead-lettered
- **Rate limiter** — live token counts per channel, draining as a burst runs
- **Transitions** — a diff of each poll, so state changes read as a timeline
- **Inspector** — click any chip for its full `AttemptLog` history: provider,
  worker, duration, error code, backoff

### Why the burst is 25

The seeded template is **SMS**, capped at 20 dispatches per minute, and the
token bucket starts full. Sending exactly 20 would consume the bucket without
ever refusing anything — so a burst of 25 is what makes the limiter observable:
20 go straight out, 5 park in `RATE_LIMITED`, and they drain on the next refill.

Each send uses a fresh `recipientId`. The idempotency key is
`recipientId|channel|templateId|bodyHash|scheduledAt`, and the body is fixed by
the template, so a repeated recipient would collide and return the existing
notification instead of creating a new one — a burst of 25 identical requests
would produce exactly one row and nothing would move.

### Seeding

`src/seed.ts` upserts the one template against `@@unique([name, channel])`, so
it is safe to run on every deploy. `npm run release` is
`prisma migrate deploy && node dist/seed.js` — use that as the pre-deploy command
rather than `migrate deploy` alone, or the dashboard has no template to send from.

### Running it

There is no local database. `DATABASE_URL` and `REDIS_URL` point at the hosted
Railway datastores, so development runs against the same Postgres and Redis as
production — copy `postman-server/.env.example` to `.env` and fill in the two
connection strings from the Railway dashboard.

```bash
# 1. schema (only after changing prisma/schema.prisma)
cd postman-server && npx prisma migrate deploy

# 2. api, worker, scheduler (separate shells)
npm run dev
npm run dev:worker
npm run dev:scheduler

# 3. dashboard → http://localhost:4000
cd ../postman-client && npm run dev
```

The API listens on `:3000` and the dashboard on `:4000`. The browser calls the
API directly, so the API's `CORS_ORIGIN` must include the dashboard's origin —
it defaults to `http://localhost:4000`, which is what local development needs.

Because dev and production share a queue, a local worker competes with the
deployed one for jobs. That is the design working as intended, but give the
local worker a distinct `WORKER_ID` so the dashboard shows you which is which.

## ☁️ Deployment

| Piece | Host | Notes |
|---|---|---|
| Dashboard | Vercel | Root directory `postman-client`. Fully static — no serverless functions |
| `api`, `worker`, `scheduler` | Railway | Root directory `postman-server`, one service each, same build |
| Postgres, Redis | Railway | Reached over the private network; no public endpoint needed |

Railway builds from source — there is no Dockerfile and no compose file. Build
once with `npm run build`, then each service runs a different start command:

| Service | Start command | Public domain | Health check |
|---|---|---|---|
| `api` | `npm start` | yes | `/health` |
| pre-deploy on `api` | `npm run release` (migrate + seed) | — | — |
| `worker` | `npm run start:worker` | no | none |
| `scheduler` | `npm run start:scheduler` | no | none |

Set `npm run release` as the **pre-deploy command on `api` only**, so the three
services don't race each other to migrate or seed.

`/health` returns 200 when Postgres answers, 503 when it doesn't, and reports
`degraded` when Postgres is up but Redis is not — Redis only gates dispatch, and
restarting the API would not bring it back, so it must not fail the health check.

### Abuse limits

The deployed API is public and unauthenticated — the dashboard is meant to be
clicked by strangers, and "Send" is the whole demo. So writes are bounded rather
than closed:

| Guard | Behaviour |
|---|---|
| Per-IP write limit | 30 writes / 60s, counted in Redis, applied to every `POST`/`PUT`/`PATCH`/`DELETE`. Returns `429` with `retry-after` |
| Admin token | `POST /templates` and `POST /dlq/requeue-all` need the `x-admin-token` header — durable shared state and a bulk operation over every dead-lettered row |
| Retention | The scheduler purges terminal notifications older than `RETENTION_DAYS` (7), under the same advisory lock, capped per cycle so it never holds locks against the workers' queue |

Two deliberate choices worth knowing. The limiter **fails open** if Redis is
unreachable — dispatch is already halted in that state, so the exposure is a
short window of unlimited writes rather than an outage stacked on an outage. And
the admin gate **fails closed** in production: an unset `ADMIN_TOKEN` there is a
misconfiguration, not permission to open the routes to everyone.

Per-IP limiting only works because `trustProxy` is enabled in `app.ts` — behind
Railway's edge every request otherwise carries the proxy's address, which would
collapse the per-IP limit into one shared global bucket.

### Environment variables

| Variable | api | worker | scheduler | Vercel |
|---|:--:|:--:|:--:|:--:|
| `DATABASE_URL` | • | • | • | |
| `REDIS_URL` | • | • | | |
| `PORT` | auto | | | |
| `CORS_ORIGIN` | • | | | |
| `ADMIN_TOKEN` | • | | | |
| `RETENTION_DAYS` | | | • | |
| `WORKER_ID` | | • | | |
| `NEXT_PUBLIC_API_URL` | | | | • |

On Railway use reference syntax rather than pasting connection strings, so they
rotate with the datastore: `${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`.

`NEXT_PUBLIC_API_URL` is **inlined at build time**, not read at runtime — change
it and you must redeploy the dashboard for it to take effect.

### Demo-speed knobs

Production timings make for a slow demo. These are read from the environment:

| Variable | Default | Effect |
|---|---|---|
| `SCHEDULER_INTERVAL_MS` | `60000` | How often scheduled notifications are promoted |
| `POLL_INTERVAL_MS` | `1000` | Worker poll interval |
| `BACKOFF_BASE_SECONDS` | `30` | First retry delay; doubles each attempt |
| `MAX_BACKOFF_SECONDS` | `300` | Retry delay ceiling |
| `WORKER_ID` | `worker-1` | Run several workers with distinct ids to watch them compete |
| `NEXT_PUBLIC_POLL_INTERVAL_MS` | `1000` | Dashboard poll interval (client, build-time) |
| `HEALTH_PROBE_TIMEOUT_MS` | `2000` | How long `/health` waits on a dependency before calling it down |

Running a second worker with `WORKER_ID=worker-2 npm run dev:worker` makes the
visibility-timeout claim visible: each job is only ever held by one of them.

Production runs a single worker. The dashboard polls four endpoints per tick and
that traffic is billed egress, so it stops polling entirely while the browser tab
is hidden and refreshes the moment you return to it.

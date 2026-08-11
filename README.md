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

- **Compose** — pick a template (variables are read out of `{{placeholders}}`
  and posted as `metadata`) or send ad-hoc content, choose channel, priority and
  a schedule offset, then send one or burst 20 through `POST /notifications/batch`
- **Pipeline** — API → Postgres → scheduler → queue → workers → dispatch, with
  every notification rendered as a chip in whichever stage currently holds it
- **Outcomes** — delivered, waiting out retry backoff, or dead-lettered
- **Rate limiter** — live token counts per channel
- **Transitions** — a diff of each poll, so state changes read as a timeline
- **Inspector** — click any chip for its full `AttemptLog` history: provider,
  worker, duration, error code, backoff

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
| `worker` | `npm run start:worker` | no | none |
| `scheduler` | `npm run start:scheduler` | no | none |

Set `prisma migrate deploy` as the **pre-deploy command on `api` only**, so the
three services don't race each other to migrate.

`/health` returns 200 when Postgres answers, 503 when it doesn't, and reports
`degraded` when Postgres is up but Redis is not — Redis only gates dispatch, and
restarting the API would not bring it back, so it must not fail the health check.

### Environment variables

| Variable | api | worker | scheduler | Vercel |
|---|:--:|:--:|:--:|:--:|
| `DATABASE_URL` | • | • | • | |
| `REDIS_URL` | • | • | | |
| `PORT` | auto | | | |
| `CORS_ORIGIN` | • | | | |
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

# ReachInbox Email Scheduler

A production-grade, multi-tenant email scheduling service designed to manage user campaigns, parse recipient leads, and run high-concurrency delayed queues with distributed rate-limiting.

---

## 1. System Overview

The ReachInbox Email Scheduler consists of a React frontend SPA, an Express.js API, and a decoupled BullMQ email worker process. Together, they coordinate delayed dispatches, enforce strict hourly sender limits, handle restart recovery, and isolate data on a multi-user basis.

```text
                ┌───────────────┐
                │    React UI   │
                └───────┬───────┘
                        │ (HTTPS + Secure Cookie)
                        ▼
                ┌───────────────┐
                │ Express API   │
                └───────┬───────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
    PostgreSQL       Redis          Google OAuth
         │              │
         │              ▼
         │          BullMQ Queue
         │              │
         │              ▼
         │        Email Worker
         │              │
         │              ▼
         └────────── Ethereal SMTP
```

---

## 2. Core Features

- **Real Google OAuth 2.0:** Secure authorization flow utilizing Passport.js.
- **Secure Sessions:** Redis-backed express-session store with HTTP-only, SameSite cookies.
- **Multi-Tenant Scoping:** Strict user resource isolation enforced database-side.
- **Delayed Queue System:** BullMQ queue with native Redis-backed timer scheduling.
- **Decoupled Worker Concurrency:** Standalone worker process with configurable parallel execution.
- **Distributed Rate Limiting:** Redis Lua atomic script checking sender quotas and spacing delays.
- **Rescheduling Engine:** Denied limits automatically delay and re-enqueue jobs without consuming retry limits.
- **Exactly-Once sent checks:** Atomic database row-locks preventing duplicate worker execution.
- **Failure Recovery:** Startup recovery routines resolving server crashes or worker restarts.
- **Lead Parser:** Client-side CSV/TXT email lead extractor with format check and deduplication.
- **Rich Dashboard:** Interactive scheduled/sent tabs, loader states, detail modals, and retry/cancel actions.

---

## 3. Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Axios, React Router, Lucide React
- **Backend:** Node.js, Express, TypeScript, Prisma ORM, PostgreSQL, Redis, BullMQ, Nodemailer
- **Testing:** Jest (Backend unit/integration/reliability), Vitest + jsdom (Frontend unit)
- **Infrastructure:** Docker Compose (PostgreSQL, Redis)

---

## 4. Project Structure

```text
email-job-scheduler/
├── backend/
│   ├── prisma/             # Schema & migrations
│   ├── src/
│   │   ├── config/         # App, DB, Redis, Passport configs
│   │   ├── controllers/    # Route controllers
│   │   ├── middleware/     # Auth & validation middlewares
│   │   ├── queue/          # BullMQ queue & worker loop
│   │   ├── routes/         # Router declarations
│   │   ├── services/       # Core DB, rate limiter & email service
│   │   ├── utils/          # Load test & ethereal test scripts
│   │   └── app.ts          # Server entry
│   └── tests/              # Backend Jest test suite
│
├── frontend/
│   ├── src/
│   │   ├── components/     # Layout & UI components
│   │   ├── context/        # Auth & Toast state contexts
│   │   ├── pages/          # Login, Dashboard, Compose views
│   │   ├── services/       # Axios API clients
│   │   ├── test/           # Vitest setup & unit tests
│   │   ├── types/          # TypeScript interfaces
│   │   └── App.tsx         # Router definitions
│   └── vite.config.ts      # Vite config
│
├── docs/                   # Concise technical docs
└── docker-compose.yml      # PG & Redis stack definition
```

---

## 5. Local Setup

### Prerequisite Checklist
- Install [Node.js](https://nodejs.org/) (v18+ recommended)
- Install and start [Docker Desktop](https://www.docker.com/)

### Step 1: Start Infrastructure Stack
In the root directory, start PostgreSQL and Redis:
```bash
docker compose up -d
```
*This binds PostgreSQL on `5432` and Redis on `6379`.*

### Step 2: Configure Backend Environment
Navigate to the `backend/` directory, copy the environment file, and install dependencies:
```bash
cd backend
cp .env.example .env
npm install
```
Populate your `.env` with the Google OAuth Credentials and session secret (see below).

### Step 3: Run Database Migrations
```bash
npx prisma migrate dev
```

### Step 4: Configure Frontend Environment
Navigate to the `frontend/` directory, copy the environment file, and install dependencies:
```bash
cd ../frontend
cp .env.example .env
npm install
```

---

## 6. Running the Application

### Start API Server
In the `backend/` directory, run:
```bash
npm run dev
```
*API runs at `http://localhost:5000`.*

### Start standalone Queue Worker
In another terminal in the `backend/` directory, run:
```bash
npm run worker:dev
```
*Processes emails in the background.*

### Start React Client
In the `frontend/` directory, run:
```bash
npm run dev
```
*Client runs at `http://localhost:3000`.*

---

## 7. Google OAuth Credentials Configuration

To set up Google login:
1. Open the [Google Cloud Console API Credentials page](https://console.cloud.google.com/apis/credentials).
2. Configure your **OAuth Consent Screen** (User Type: External, scope: `userinfo.email` and `userinfo.profile`).
3. Click **Create Credentials** -> **OAuth Client ID** (Application Type: Web Application).
4. Set **Authorized JavaScript Origins** to:
   - `http://localhost:5000`
   - `http://localhost:3000`
5. Set **Authorized Redirect URIs** to:
   - `http://localhost:5000/auth/google/callback`
6. Copy the **Client ID** and **Client Secret** into `backend/.env`:
   ```env
   GOOGLE_CLIENT_ID=your_id
   GOOGLE_CLIENT_SECRET=your_secret
   GOOGLE_CALLBACK_URL=http://localhost:5000/auth/google/callback
   ```

---

## 8. Environment Variables Glossary

### Backend Config (`backend/.env`)
- `PORT`: Core API port (default: 5000).
- `DATABASE_URL`: PostgreSQL connection string.
- `REDIS_HOST` / `REDIS_PORT`: Redis broker credentials.
- `SESSION_SECRET`: Key to sign session ID cookies.
- `FRONTEND_URL`: CORS origin constraint (default: http://localhost:3000).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL`: Google Console values.
- `WORKER_CONCURRENCY`: Parallel processing capability per worker (default: 5).
- `MIN_EMAIL_DELAY_SECONDS`: Spacing interval between individual emails per sender (default: 2).
- `MAX_EMAILS_PER_HOUR_PER_SENDER`: Limit allowed per hour (default: 200).
- `RATE_LIMIT_WINDOW_SECONDS`: Window scope (default: 3600).
- `EMAIL_JOB_ATTEMPTS`: Queue retry attempts for SMTP errors (default: 3).
- `EMAIL_RETRY_BACKOFF_MS`: Backoff base interval (default: 5000).

### Frontend Config (`frontend/.env`)
- `VITE_API_URL`: Backend URL (default: http://localhost:5000).

---

## 9. Architecture Deep-Dive

### Scheduling & Dispatch Flow
1. **API Scheduling:** `POST /api/emails/schedule` validates input, maps user ID from session, and writes Campaign and Email records inside an atomic PostgreSQL transaction.
2. **Queue Injection:** The backend calculates delay (`scheduledAt - Date.now()`) and pushes the job to BullMQ/Redis with the deterministic ID (`email-{emailId}`).
3. **Acquisition:** The Worker picks up the job and tries to mutate the status to `PROCESSING` where it is currently `SCHEDULED`. If another worker got it, it aborts.
4. **Rate Reservation:** It executes a Redis Lua script to reserve a slot.
   - *Passed:* Dispatches email via Nodemailer Ethereal SMTP, updates DB to `SENT` with preview URL.
   - *Blocked:* Reschedules the email in the DB for the calculated next allowed slot, deletes the active job from Redis, and enqueues a delayed job in BullMQ for the new time.

### Redis Lua Rate Limiter
The Redis Lua script atomically:
1. Fetches the sender hourly count (`email-rate:sender:{senderId}:{utcHour}`).
2. If count exceeds hourly quota, returns `denied` with next hour's timestamp.
3. Fetches last send timestamp (`email-rate:last-send:sender:{senderId}`).
4. If difference is less than `MIN_EMAIL_DELAY_SECONDS`, returns `denied` with next allowed spacing epoch.
5. If allowed, updates the last send timestamp, increments the hourly count, and returns `allowed`.

### Failure Recovery & Restarts
- **Unsubmitted Jobs:** On startup, the API scans for emails marked `SCHEDULED` but with a `null` `bullJobId` (crash after PG write but before Redis write) and enqueues them.
- **Stalled Worker Jobs:** On startup, the worker scans for emails stuck in `PROCESSING` status (due to worker crash) and reverts them back to `SCHEDULED`, re-enqueueing the jobs.

---

## 10. Verification & Test Suites

### Backend Test Suite
Contains 35 unit, integration, and reliability checks:
```bash
cd backend
npm run test
```

### Frontend Test Suite
Uses Vitest + jsdom to test routing, login buttons, parsing states, detail modals, and validation errors:
```bash
cd frontend
npm run test
```

### Flow Verification Utilities
- **Ethereal Mail Test:** Schedules and dispatches a test email, printing Ethereal web preview links:
  ```bash
  cd backend
  npm run test:ethereal
  ```
- **Concurrency & Throttling Load Test:** Schedules 200 emails, overrides rate limits, spawns 3 concurrent worker threads, and verifies scheduling safety:
  ```bash
  cd backend
  npm run test:load
  ```

---

## 11. Security Scopes
- **Authentication:** Signed cookie storage via session keys. Credentials are never sent raw.
- **Isolation:** Scoped SQL queries using `userId = req.user.id` on Prisma schema maps.
- **CORS Lock:** Express CORS restricts connections to the `FRONTEND_URL` and requires credentials.
- **Exactly-Once Limit:**
  > [!WARNING]
  > If a worker crashes immediately after SMTP accepts the email but before updating PostgreSQL to `SENT`, a retry will result in a duplicate send. This is a standard limitation of non-transactional SMTP.

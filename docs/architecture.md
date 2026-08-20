# System Architecture

This document describes the high-level architecture, component communication, and scheduling request flow of the ReachInbox Email Scheduler.

## Component Overview

```text
                ┌───────────────┐
                │    React UI   │
                └───────┬───────┘
                        │ (HTTPS + Credentials Session Cookie)
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

The system is split into three main execution tiers:
1. **Client Tier (React UI):** A single-page application built using Vite, Tailwind CSS, and TypeScript. Interfaces with Google OAuth and the Backend API using Axios with credentials enabled.
2. **Server Tier (Express API):** A stateless Node.js process managing session authentication via Redis and exposing REST endpoints for scheduling, list querying, retrying, and cancelling emails.
3. **Async Queue Worker (Email Worker):** A decoupled Node.js process that pulls queued jobs from BullMQ/Redis, enforces per-sender hour windows and min-delay rate-limits, dispatches emails using Nodemailer SMTP, and updates PostgreSQL.

---

## Complete Scheduling & Dispatch Flow

1. **Scheduling Requests:**
   - The React client parses a list of recipients from CSV/TXT, prompts the user for subject/body inputs and scheduling rules, and sends a `POST /api/emails/schedule` payload to the backend.
   - The backend validates fields via Zod, extracts `req.user.id` from the secure Redis session, and creates the Campaign and Email records inside a single **atomic PostgreSQL transaction**.
   - After transaction commitment, it enqueues delayed jobs into BullMQ with a calculated delay:
     $$\text{delay} = \max(0, \text{scheduledAt} - \text{Date.now()})$$
     Job IDs are generated deterministically as `email-{emailId}` for idempotency.
   - Once enqueued, the `bullJobId` is updated in the database.

2. **Async Worker Processing:**
   - The standalone Worker process wakes up when BullMQ delays expire.
   - It performs an atomic database state lock:
     `UPDATE Email SET status = 'PROCESSING' WHERE id = :id AND status = 'SCHEDULED'`
     If 0 rows are updated, the worker immediately skips processing (idempotency safety).
   - The worker runs `RateLimitService.reserveSendSlot(senderId)` which executes an atomic Redis Lua script.
   - **Rate limit check passes:** The worker initiates SMTP dispatch via Nodemailer, waits for Ethereal acceptance, and updates the email status to `SENT` along with its `messageId` and `previewUrl`.
   - **Rate limit check fails (quota or minimum delay exceeded):** The worker reads the exact `nextAllowedAt` timestamp from the Lua script response. It updates the database `scheduledAt = nextAllowedAt`, removes the active job from Redis, and enqueues a new delayed job with the deterministic ID (`email-{emailId}`), ensuring the job cascades safely without consuming SMTP retry attempts.

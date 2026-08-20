# Reliability, Recovery and Idempotency

This document describes how the Email Scheduler maintains reliability, idempotency, and recovery across restarts and database/Redis/SMTP failures.

---

## 1. Idempotency Protection
In a highly concurrent, distributed system, a single BullMQ job might occasionally execute multiple times due to networking hiccups or worker crashes. We protect against duplicate sends using a multi-tiered approach:

- **Deterministic Job IDs:** Every enqueued email job has a deterministic ID generated as `email-{emailId}`. If a scheduling request tries to insert a duplicate key, Redis/BullMQ natively rejects the insertion.
- **Atomic Database Locks:** Immediately upon picking up a job, the worker executes a state mutation:
  ```sql
  UPDATE Email 
  SET status = 'PROCESSING', processingStartedAt = NOW() 
  WHERE id = :id AND status = 'SCHEDULED'
  ```
  This is executed inside an atomic database update. If zero rows are returned, it means another worker has already acquired this job, and the current worker skips it.
- **Sentinel Check:** If the status in PostgreSQL is already `SENT`, the job immediately returns and does not proceed to Nodemailer SMTP.

---

## 2. Recovery from Server Restarts

### API Crashes
If the API server crashes after writing campaign data to PostgreSQL but before successfully registering jobs in Redis/BullMQ:
- The emails are persisted in PostgreSQL with `status = 'SCHEDULED'` but their `bullJobId` is `null`.
- On startup, the server runs a recovery scan:
  `SELECT * FROM Email WHERE status = 'SCHEDULED' AND bullJobId IS NULL`
  It enqueues all missing items into BullMQ and updates their `bullJobId`.

### Worker Crashes & Restarts
- If a worker crashes while processing a job, the database record remains stuck in `'PROCESSING'`.
- On worker startup, a scan selects processing emails:
  `SELECT * FROM Email WHERE status = 'PROCESSING' AND processingStartedAt < :threshold`
  It resets their status back to `'SCHEDULED'` and re-enqueues them, ensuring no jobs are orphaned indefinitely.
- Redis volume persistence is set up in `docker-compose.yml` to survive service restarts.

---

## 3. Failure & Fail-Safe Handling

### Redis Outage
If Redis is down, the system fails safe:
- Rate limiting checks throw an error.
- The worker catches this error, rolls back the email status from `PROCESSING` to `SCHEDULED` in PostgreSQL, and bubbles the error up to BullMQ to delay the retry attempt.
- No emails bypass rate limits.

### PostgreSQL Outage
If PostgreSQL goes down while sending, the worker will be unable to mark the email as `SENT`. It will catch this database error, and the SMTP transaction will not be finalized. BullMQ will retry the job.

### SMTP Dispatch Failure
- If Nodemailer encounters a transient SMTP error (e.g. connection timeout), it fails the job.
- The worker increments the `attempts` column in PostgreSQL and reverts the status to `SCHEDULED`.
- BullMQ automatically applies an exponential backoff retry.
- After all attempts are exhausted, the status permanently updates to `FAILED` and stores the `errorMessage`.

---

## 4. SMTP Exactly-Once Limitation
> [!CAUTION]
> **Exactly-Once Delivery Limitation:** Because SMTP does not participate in distributed database transactions, there is a tiny window of vulnerability. If a worker dispatches the email and Ethereal accepts it, but the worker crashes immediately before updating PostgreSQL to `SENT`, a subsequent worker retry will dispatch the email again, resulting in a duplicate send. This is a standard limitation of SMTP integration.

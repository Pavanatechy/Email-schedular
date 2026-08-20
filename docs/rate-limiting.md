# Distributed Rate Limiting & Throttling

This document describes the design and operation of the Redis-backed distributed rate limiter and throttling mechanics.

---

## 1. Why Redis is Required
In production, multiple instances of the API and multiple workers process scheduled emails concurrently. Using an in-memory counter on any single node cannot coordinate limits across other nodes. Redis acts as a high-performance, centralized, atomic state store to coordinate limits globally.

---

## 2. Key Mechanics & Keys
1. **Sliding Hour Quota:**
   - Partitioned by hour using UTC dates: `email-rate:sender:{senderId}:{utcHourWindow}` (format: `YYYY-MM-DDTHH`).
   - Every send increments this counter. If the value exceeds the quota (e.g., 200), subsequent sends are blocked.
   - Keys are configured with a TTL of 1.5 hours to automatically clean up Redis memory.
2. **Minimum Spacing Delay:**
   - Tracked via a single key: `email-rate:last-send:sender:{senderId}`.
   - Holds the timestamp of the last dispatched email. If the difference between `Date.now()` and this timestamp is less than `MIN_EMAIL_DELAY_SECONDS`, the request is denied.
3. **Atomic Evaluation via Lua:**
   - Checking the hourly count, checking the last send timestamp, updating the last send timestamp, and incrementing the count are performed in a single, block-free **Redis Lua script**. This guarantees thread-safety and prevents race conditions.

---

## 3. Rescheduling Mechanics
When a worker picks up an email job and the rate limit check is denied (due to either hourly limit or spacing delay):
1. The Lua script returns the exact epoch timestamp (`nextAllowedAt`) representing when the sender will be clear to send again.
2. The worker updates the email's `scheduledAt` property in PostgreSQL to `nextAllowedAt`.
3. The worker removes the active job from the BullMQ queue (`job.remove()`).
4. The worker enqueues a new delayed job in BullMQ with a delay equal to:
   $$\text{delay} = \max(0, \text{nextAllowedAt} - \text{Date.now()})$$
5. This preserves the deterministic job ID (`email-{emailId}`). The email is not marked as failed, and no retry attempts are consumed.

---

## 4. 1000+ Email Scheduling Example
If 1000 emails are scheduled simultaneously for the same sender with the following rules:
- `MAX_EMAILS_PER_HOUR_PER_SENDER = 200`
- `MIN_EMAIL_DELAY_SECONDS = 2`

The execution distributes as follows:
- **Hour 1:** The worker dispatches 200 emails, spaced exactly 2 seconds apart (taking 400 seconds). The 201st email is denied, updates its `scheduledAt` to the start of Hour 2, and is rescheduled with a delay.
- **Hour 2:** Dispatches 200 emails, spaced 2 seconds apart. The remaining are pushed to Hour 3.
- **Hour 3:** Dispatches 200 emails.
- **Hour 4:** Dispatches 200 emails.
- **Hour 5:** Dispatches the final 200 emails.
- The cascading behavior runs automatically and cleanly across all workers without hitting Ethereal SMTP limits.

# Testing Strategy

This document details the test suites, verification scripts, and automated scenarios of the Email Scheduler.

---

## 1. Automated Test Suites

### Backend Tests (Jest)
Located in `backend/tests/`:
1. **`auth.test.ts` (16 tests):** Validates OAuth initiation, user profile mapping, secure session creation, logout, and multi-tenant resource isolation (verifying User A cannot fetch or mutate User B's campaigns/emails).
2. **`email.test.ts` (8 tests):** Tests validation, scheduling transactions, rate limiting hourly quotas, spacing delay throttling, worker rescheduling, and Redis fail-safe rollbacks.
3. **`reliability.test.ts` (11 tests):** Tests recovery scenarios including API startup scans (identifying enqueued emails without a job ID) and worker startup scans (picking up and resetting processing logs stalled by restarts).

Run all backend tests:
```bash
npm run test
```

### Frontend Tests (Vitest)
Located in `frontend/src/test/`:
- **`frontend.test.tsx` (6 tests):** Uses React Testing Library to verify:
  - Login page render and Google authentication redirect button.
  - Protected routes redirecting unauthorized sessions to `/login`.
  - Dashboard logs rendering, tab selectors, skeletons, empty status templates.
  - Modal details display (verifying links for preview URLs and failed logs error traces).
  - Validation messages for invalid subject/body fields in the Compose view.

Run all frontend tests:
```bash
npm run test
```

---

## 2. Dynamic Integration & Load Test Scripts

### Ethereal SMTP Flow Test
Verify Nodemailer Ethereal SMTP integrations, worker loop executions, and database updates:
Ensure Redis is running, then inside the `backend` folder run:
```bash
npm run test:ethereal
```
Upon completion, it prints the live preview web URL to verify the sent message layout.

### Distributed Rate Limiting Load Test (1000+ Email Simulation)
Simulates concurrent, high-volume queue workloads:
- Configures 200 emails.
- Sets scaled-down limits (100 emails/hr quota, 20ms delay, 15-second windows) to execute in seconds.
- Spawns 3 worker threads processing in parallel.
- Asserts that all 200 emails are processed under rate limits, spacing constraint rules are not violated, and exceeding jobs are correctly rescheduled to the next window.

Run the load test:
Ensure Redis is running, then inside the `backend` folder run:
```bash
npm run test:load
```

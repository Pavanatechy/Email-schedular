# API Documentation

This document describes all API endpoints exposed by the ReachInbox Email Scheduler backend.

---

## Authentication Endpoints

### 1. Initiate Google OAuth
* **Method:** `GET`
* **Path:** `/auth/google`
* **Authentication:** None.
* **Description:** Redirects the user to the Google OAuth consent page.

---

### 2. Google OAuth Callback
* **Method:** `GET`
* **Path:** `/auth/google/callback`
* **Authentication:** None (Callback).
* **Description:** Google redirects back here with a code. The backend exchanges the code for user profiles, links accounts by email, instantiates a session, and redirects to the frontend dashboard.

---

### 3. Get Authenticated User Profile
* **Method:** `GET`
* **Path:** `/auth/me`
* **Authentication:** Required (Session cookie).
* **Response (Success - 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "cd8a7625-b387-4191-a522-0328c644c31e",
      "name": "Pavana",
      "email": "pavana@example.com",
      "avatarUrl": "https://avatar-url.com/image.png"
    }
  }
  ```
* **Response (Failure - 401 Unauthorized):**
  ```json
  {
    "success": false,
    "message": "Authentication required"
  }
  ```

---

### 4. Log Out
* **Method:** `POST`
* **Path:** `/auth/logout`
* **Authentication:** Required.
* **Description:** Destroys the active session in Redis and clears the client's cookie.
* **Response (Success - 200 OK):**
  ```json
  {
    "success": true,
    "message": "Logged out successfully"
  }
  ```

---

## Email Scheduling Endpoints

### 5. Schedule Campaign & Emails
* **Method:** `POST`
* **Path:** `/api/emails/schedule`
* **Authentication:** Required.
* **Request Body:**
  ```json
  {
    "subject": "Email Campaign",
    "body": "Hi there!",
    "startTime": "2026-08-20T10:00:00.000Z",
    "delaySeconds": 2,
    "hourlyLimit": 200,
    "recipients": [
      "lead1@example.com",
      "lead2@example.com"
    ]
  }
  ```
* **Response (Success - 201 Created):**
  ```json
  {
    "success": true,
    "message": "Emails scheduled successfully",
    "data": {
      "campaignId": "26e7d768-d824-48c3-b110-59a41e69d581",
      "totalRecipients": 2,
      "queuedEmails": 2
    }
  }
  ```
* **Response (Validation Failure - 400 Bad Request):**
  ```json
  {
    "success": false,
    "message": "Validation failed",
    "errors": [
      {
        "field": "recipients",
        "message": "At least one recipient is required"
      }
    ]
  }
  ```

---

### 6. Get Scheduled Emails
* **Method:** `GET`
* **Path:** `/api/emails/scheduled`
* **Authentication:** Required.
* **Query Parameters:**
  - `page` (optional, default: 1)
  - `limit` (optional, default: 20)
* **Response (Success - 200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "email-uuid",
        "recipient": "receiver@example.com",
        "subject": "Subject",
        "body": "Body",
        "scheduledAt": "2026-08-20T10:00:00.000Z",
        "status": "SCHEDULED",
        "attempts": 0
      }
    ],
    "pagination": {
      "total": 1,
      "pages": 1,
      "page": 1,
      "limit": 20
    }
  }
  ```

---

### 7. Get Sent and Failed Emails
* **Method:** `GET`
* **Path:** `/api/emails/sent`
* **Authentication:** Required.
* **Query Parameters:**
  - `page` (optional, default: 1)
  - `limit` (optional, default: 20)
* **Description:** Retrieves all logs with status `SENT` or `FAILED`.
* **Response (Success - 200 OK):** Same paginated structure as scheduled logs.

---

### 8. Get Email Details
* **Method:** `GET`
* **Path:** `/api/emails/:id`
* **Authentication:** Required.
* **Description:** Details about attempts, errors, or Ethereal preview URLs for verification.

---

### 9. Cancel Scheduled Email
* **Method:** `POST`
* **Path:** `/api/emails/:id/cancel`
* **Authentication:** Required.
* **Description:** Cancels an email that has not yet been processed. Removes it from BullMQ.
* **Response (Success - 200 OK):**
  ```json
  {
    "success": true,
    "message": "Email cancelled successfully",
    "data": { "id": "email-uuid", "status": "CANCELLED" }
  }
  ```

---

### 10. Retry Failed Email
* **Method:** `POST`
* **Path:** `/api/emails/:id/retry`
* **Authentication:** Required.
* **Description:** Re-schedules a `FAILED` email immediately.
* **Response (Success - 200 OK):**
  ```json
  {
    "success": true,
    "message": "Email retry scheduled successfully",
    "data": { "id": "email-uuid", "status": "SCHEDULED" }
  }
  ```

---

## Health Check Endpoints

### 11. Core Health
* **Method:** `GET`
* **Path:** `/health`
* **Description:** Checks if API server is up.

---

### 12. Dependency Health
* **Method:** `GET`
* **Path:** `/health/dependencies`
* **Description:** Runs connections to PostgreSQL and Redis.
* **Response:**
  ```json
  {
    "status": "ok",
    "database": "connected",
    "redis": "connected"
  }
  ```

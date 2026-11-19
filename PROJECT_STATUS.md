# Project Status: Interview Ops — Technical Hiring Platform

## Current Phase: Phase 4 — Secure Code Execution & Test-Case Evaluation

**Status**: Completed  
**Infrastructure Model**: 100% Managed Cloud (MongoDB Atlas + Upstash Redis) + Self-Hosted Isolated Execution Engine (Judge0 Community Edition)  
**Last Updated**: 2026-11-20  

---

## 1. Executive Summary

Phase 4 has been completed in strict accordance with the project requirements, architectural boundaries, and application security model:

- **Platform Rebranded to Interview Ops**: The user-facing and internal branding has been updated to **Interview Ops** across all UI headers, navigation bars, invitation acceptance flows, and automated test suites.
- **Asynchronous Execution Architecture**: The control plane (Express API) never executes candidate code directly. Submissions are enqueued into a dedicated BullMQ `code-execution` queue over Upstash Redis with TLS. The API returns an immediate `201 Created` with `status: "queued"`, maintaining responsiveness under heavy traffic.
- **Dedicated Execution Worker Plane (`apps/worker`)**: A standalone worker process consumes execution jobs, runs test cases sequentially against an execution provider, updates MongoDB Atlas directly with normalized execution results, and publishes completion events to Upstash Redis.
- **Provider Abstraction (`ExecutionProvider`)**:
  - `Judge0ExecutionProvider`: Connects to self-hosted Judge0 Community Edition via private REST API with Base64 encoding/decoding, wall-clock timeout protection (2.0s default), memory limit enforcement (256 MB default), output truncation (64 KB buffer cap), and automatic abort on compilation errors.
  - `MockExecutionProvider`: High-speed, deterministic mock provider for CI and offline unit testing with zero external dependencies.
- **Public vs. Hidden Test Evaluation & Candidate Privacy**:
  - "Run Code" (`submissionType: "run"`): Evaluates public test cases only.
  - "Submit Solution" (`submissionType: "submit"`): Evaluates all public and private hidden test cases.
  - **Zero Leakage Security**: Hidden test inputs, expected outputs, actual program outputs, compiler diagnostics, and internal stack traces are strictly stripped from candidate API responses and WebSocket broadcast payloads. Only authorized interviewers and organization admins have access to full test evaluation details.
- **Real-Time Execution Updates**: Upstash Redis pub/sub (`submission:events`) delivers execution updates back to the API layer, which broadcasts `submission:completed` and `submission:failed` events over Socket.IO to the room `interview:${interviewId}` with a polling fallback via `GET /api/v1/submissions/:submissionId/status`.
- **Integrated Test Runner UI**: The interview workspace features a tabbed test result runner (`TestResultPanel`), interactive test case switcher, detailed metrics (duration ms, memory KB), output inspection, and submission history review.

---

## 2. Completed Deliverables

### A. Core Foundation & Auth (Phases 0 & 1)
- Argon2id password hashing, JWT access tokens (15m), and HMAC-SHA256 hashed refresh tokens with family-wide reuse revocation.
- Double-submit CSRF cookie/header validation and Origin checking.
- Multi-tenant organization scoping with RBAC (`owner`, `admin`, `interviewer`).
- Organization teammate invitation lifecycle.

### B. Assessment & Interview Management (Phase 2)
- Question bank with multi-language starter code, test suites (public and hidden), and versioning.
- Assessment templates grouping questions.
- Interview lifecycle management (`draft`, `scheduled`, `waiting`, `live`, `completed`, `cancelled`) with immutable question snapshots.
- Candidate invitation creation with cryptographically secure token hashing.

### C. Live Interview Environment (Phase 3)
- Live interview room module with presence tracking and synchronized events.
- Collaborative Monaco code editor backed by Yjs with debounced MongoDB Atlas persistence.
- LiveKit voice and video service with role-scoped room tokens and graceful local fallback.
- Candidate invitation acceptance flow and scoped room JWT authentication.

### D. Secure Code Execution & Test-Case Evaluation (Phase 4)

#### 1. Execution Provider Abstraction (`apps/worker/src/providers/`)
- `execution-provider.interface.js`: Pluggable abstract class contract (`execute`, `ping`).
- `judge0.provider.js`: Production-ready Judge0 Community Edition provider with Base64 encoding/decoding, 64 KB stdout/stderr buffer capping, 2.0s wall-clock timeout, 256 MB memory limit, and compilation error short-circuiting.
- `mock.provider.js`: Deterministic, offline execution provider for CI and unit test execution.
- Configurable via `EXECUTION_PROVIDER` (`judge0` or `mock`).

#### 2. Queue & Background Worker Architecture
- **BullMQ Producer (`apps/api/src/modules/queue/execution-queue.service.js`)**: Enqueues jobs to `code-execution` queue over Upstash Redis with exponential backoff and idempotency.
- **Execution Processor (`apps/worker/src/processors/execution.processor.js`)**: Fetches job data, executes test cases sequentially, saves normalized `executionResult` in MongoDB Atlas, and publishes `submission:events` to Redis.
- **Worker Process (`apps/worker/src/index.js`)**: Standalone consumer with graceful shutdown handling (SIGINT/SIGTERM).

#### 3. Real-Time Execution Events & Status API
- **Redis Subscriber (`apps/api/src/modules/realtime/execution-events.subscriber.js`)**: Subscribes to Redis `submission:events` and broadcasts sanitized events over Socket.IO to room `interview:${interviewId}` (`submission:completed`, `submission:failed`).
- **Status Endpoint (`GET /api/v1/submissions/:submissionId/status`)**: Lightweight polling endpoint for execution status and test results with strict candidate isolation.
- **Serializer (`apps/api/src/modules/submissions/submission.service.js`)**: Strict role-based test serialization ensuring candidate payloads never contain hidden test inputs, expected outputs, or stderr.

#### 4. Frontend Test Runner UI (`apps/web`)
- **`TestResultPanel.tsx`**: Displays test status badges (`passed`, `failed`, `compile_error`, `runtime_error`, `timeout`), peak memory, total execution duration, tabbed test cases, and hidden test masking notice.
- **`SubmissionPanel.tsx`**: Adds "Test Results" tab, "Run Code" button, and "Submit Solution" modal with confirmation prompt.
- **`useInterviewSocket.ts`**: Listens for `submission:queued`, `submission:completed`, and `submission:failed` with automatic fallback to polling `GET /submissions/:id/status`.
- **`InterviewRoomPage.tsx`**: Ties editor state to execution triggers, managing loading indicators and active result tabs.

#### 5. Infrastructure & Deployment Documentation
- **`docs/JUDGE0_DEPLOYMENT.md`**: Complete production guide for deploying self-hosted Judge0 Community Edition via Docker Compose on an isolated VPS, including cgroups v2 configuration, `judge0.conf` security flags, UFW firewall allowlisting, and systemd service management.

---

## 3. Verification & Test Summary

| Package / Workspace | Test Suite                   | Focus Areas                                                                 | Status  |
| ------------------- | ---------------------------- | --------------------------------------------------------------------------- | ------- |
| `@platform/shared`  | `envelope.test.js`           | Envelope creation, error codes, constants, submission lifecycle             | Passing |
| `@platform/api`     | `env.test.js`                | Upstash Redis & Atlas validation scenarios                                  | Passing |
| `@platform/api`     | `redis.test.js`              | BullMQ requirements, TLS, dependency injection                              | Passing |
| `@platform/api`     | `app.test.js`                | Express init, Request ID tracing, 404 handler                               | Passing |
| `@platform/api`     | `health.test.js`             | Liveness probe (`/api/v1/health`)                                           | Passing |
| `@platform/api`     | `readiness.test.js`          | Readiness probe with healthy vs degraded DB/Redis                           | Passing |
| `@platform/api`     | `error.test.js`              | Centralized AppError handling & 500 fallback                                | Passing |
| `@platform/api`     | `permissions.test.js`        | Owner/admin/interviewer matrix, role changes, member removal guards         | Passing |
| `@platform/api`     | `auth.test.js`               | Register, login, refresh rotation, reuse revocation, CSRF, /auth/me         | Passing |
| `@platform/api`     | `organization.test.js`       | Slug handling, tenant isolation, role changes, transfer, invitations        | Passing |
| `@platform/api`     | `question.test.js`           | Question CRUD, multi-language starter code, test suites, versioning         | Passing |
| `@platform/api`     | `assessment.test.js`         | Assessment templates, question ordering, version tracking                  | Passing |
| `@platform/api`     | `interview-room.test.js`     | Room auth, lifecycle guards, question sanitization, presence, join token    | Passing |
| `@platform/api`     | `collaboration.test.js`      | Yjs document creation, starter code seeding, debounced Mongo persistence    | Passing |
| `@platform/api`     | `submissions.test.js`        | Rate limiting, size limits, idempotency, Run/Submit flows, hidden test mask | Passing |
| `@platform/api`     | `livekit.test.js`            | LiveKit room tokens, role grants, graceful dev fallback                     | Passing |
| `@platform/web`     | `App.test.tsx`               | Layout, brand title, and page rendering                                     | Passing |
| `@platform/web`     | `AuthFlow.test.tsx`          | Login, register, protected route redirect, org onboarding                   | Passing |
| `@platform/web`     | `InterviewRoom.test.tsx`     | Header, Monaco editor, question panel, test runner controls, submission tabs| Passing |
| `@platform/worker`  | `judge0.provider.test.js`    | Base64 handling, status mapping, language IDs, timeout, buffer capping      | Passing |
| `@platform/worker`  | `execution.processor.test.js`| BullMQ execution processor, sequential test runner, Redis pub/sub           | Passing |
| `@platform/worker`  | `worker.test.js`             | BullMQ worker configuration, queue names, concurrency boundary              | Passing |

- **Total Test Count**: 107 tests passing across 22 test files in 4 workspaces (0 failing).
- **Linter Status**: ESLint (`--max-warnings=0`) and TypeScript (`tsc -b`) passing with 0 errors and 0 warnings.
- **Frontend Production Build**: Vite build completed cleanly with 0 errors.

---

## 4. Current Limitations & Deferred Items

The following items are intentionally deferred to future phases:

- **AI-Assisted Interviewer (Stage C / Phase 5+)**: LLM-driven hints, follow-up question generation, and real-time evaluation assistance.
- **Post-Interview Rubrics & Human Scorecards (Phase 5)**: Structured evaluation forms and interviewer scorecard submission.
- **LiveKit Cloud Credentials**: In development environments without LiveKit cloud credentials, video calling gracefully degrades with media controls disabled.

---

## 5. Next Steps: Phase 5 — Evaluations & Human Rubrics

Upon user instruction to proceed to Phase 5:
1. Implement interviewer rubric scorecards (`GET /interviews/:id/rubric`, `POST /interviews/:id/evaluation`).
2. Implement composite scoring criteria and post-interview outcome states.
3. Candidate summary reports and exportable assessment archives.

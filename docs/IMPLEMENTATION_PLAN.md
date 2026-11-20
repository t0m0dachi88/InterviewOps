# Implementation Plan

## 1. Delivery approach

Build Stage B in vertical, testable slices. Each phase must include backend, frontend, tests, and a demonstrable outcome. Keep the execution worker separate from the Express API from the beginning.

Do not start with microservices. Use a modular monolith for the control plane and separately deployed worker/realtime processes where isolation or scaling requires it.

## 2. Phase 0 — Repository and engineering foundation

### Backend

- Initialize Node.js project and Express application.
- Add environment validation and configuration.
- Connect MongoDB using Mongoose.
- Add Redis connection and BullMQ setup.
- Add structured logging, request IDs, centralized error handling.
- Establish module conventions and lint/format scripts.

### Frontend

- Initialize React + TypeScript application.
- Add routing, layout, API client, auth state strategy.
- Establish design tokens and reusable UI components.

### Dev environment

- Docker Compose for local MongoDB replica set (if transactions are used), Redis, and application dependencies.
- `.env.example` with placeholders only.
- Health/readiness endpoints.
- CI workflow for lint, type-check (frontend), tests, and build.

### Tests / exit criteria

- API starts and reports health.
- MongoDB and Redis connectivity are tested.
- CI passes on a clean checkout.
- No secrets are committed.

## 3. Phase 1 — Authentication and organizations

### Backend

- User registration/login/logout/refresh.
- Password hashing and refresh-token rotation.
- Organization creation.
- Membership and invitation lifecycle.
- Role and organization-scope middleware.

### Frontend

- Register/login screens.
- Organization creation/switcher.
- Member list and invite form.
- Protected routes.

### Tests / exit criteria

- Authentication unit and integration tests.
- Refresh-token reuse/revocation tests.
- Cross-organization access tests.
- Owner/admin/interviewer permission matrix.
- A user can create an organization and invite an interviewer.

## 4. Phase 2 — Interview management

### Backend

- Interview CRUD and lifecycle.
- Candidate invitation and expiring join credentials.
- Interviewer assignment.
- Question CRUD and versioning.
- Immutable question snapshot attached to interview.

### Frontend

- Interview dashboard.
- Create/edit/schedule interview.
- Candidate invitation flow.
- Interview detail and waiting-room screens.
- Question selection and configuration.

### Tests / exit criteria

- Interview lifecycle state-transition tests.
- Unauthorized candidate/interviewer join tests.
- Question snapshot regression tests.
- A company can schedule an interview and invite a candidate.

## 5. Phase 3 — Live Interview Environment [COMPLETED]

### Completed Backend Deliverables

- Live interview room module (`interview-room.service.js`, `interview-room.controller.js`, `interview-room.routes.js`).
- Dual-auth middleware (`authenticateParticipant`) supporting team members via DB sessions and candidates via scoped JWT tokens.
- Candidate invitation acceptance & join-token exchange (`candidate-invitation.service.js`, `candidate-invitation.controller.js`).
- Socket.IO Realtime Gateway with handshake authorization, room presence tracking, and synchronized events (`realtime.gateway.js`, `presence.service.js`).
- Collaborative code editing with server-side Yjs state management and debounced MongoDB persistence (`collaboration.service.js`, `collaboration.gateway.js`, `code-document.model.js`).
- Submission management API with rate limiting, size limits, idempotency keys, and immutable source snapshots (`submission.service.js`, `submission.controller.js`, `submission.model.js`).
- LiveKit token service with role-scoped room grants and graceful development fallback (`livekit.service.js`, `livekit.controller.js`).

### Completed Frontend Deliverables

- Full-screen 3-column interview workspace (`InterviewRoomPage.tsx`, `InterviewHeader.tsx`).
- Monaco Editor integration with language selection (JavaScript, Python, C++), code reset modal, and read-only mode (`CollaborativeEditor.tsx`, `useCollaborativeEditor.ts`).
- Yjs + y-monaco collaborative document synchronization with remote awareness and server sync.
- Question workspace panel displaying immutable question statements, constraints, examples, and synchronized interviewer tab switching (`QuestionPanel.tsx`).
- Submission management panel with draft saving, final submission snapshots, and immutable code inspection modal (`SubmissionPanel.tsx`).
- LiveKit audio/video panel with device toggle controls and graceful disabled fallback (`VideoRoom.tsx`).
- Public candidate invitation acceptance page (`CandidateJoinPage.tsx`).

### Completed Verification

- 93 automated tests passing across 4 workspaces (shared, api, web, worker).
- Zero TypeScript and ESLint warnings.
- Frontend production bundle builds cleanly.
- Code execution intentionally deferred to Phase 4.

## 6. Phase 4 — Execution infrastructure [COMPLETED]

This phase introduced secure code execution and test-case evaluation using self-hosted Judge0 Community Edition and asynchronous BullMQ workers.

### Backend & Queue (`apps/api`)

- BullMQ queue `code-execution` over Upstash Redis with TLS (`execution-queue.service.js`).
- Asynchronous submission handling returning `201 Created` with `status: "queued"`.
- Rate limiting (30 submissions/min) and source code size validation (128 KB limit).
- Lightweight polling endpoint `GET /api/v1/submissions/:submissionId/status`.
- Real-time subscriber (`execution-events.subscriber.js`) listening to Redis pub/sub channel `submission:events` and broadcasting `submission:completed` / `submission:failed` over Socket.IO to `interview:${interviewId}` room.
- Strict role-based test serialization (`serializeSubmission`) masking hidden test inputs and expected outputs from candidates.

### Dedicated Execution Worker (`apps/worker`)

- Standalone Node.js execution worker (`src/index.js`, `src/processors/execution.processor.js`).
- Execution provider abstraction (`ExecutionProvider`, `Judge0ExecutionProvider`, `MockExecutionProvider`).
- Base64 encoding/decoding, wall-time limit (2.0s), memory limit (256 MB), and 64 KB output buffer truncation.
- Language mappings for JavaScript (Node.js 12.14, ID 63), Python 3 (Python 3.8.1, ID 71), and C++ (GCC 9.2, ID 54).
- Direct MongoDB Atlas execution result updates and Upstash Redis pub/sub broadcasting.

### Frontend (`apps/web`)

- Test runner UI with "Run Code" (evaluates public test cases) and "Submit Solution" modal (evaluates public and hidden test cases).
- `TestResultPanel`: Status indicators (`passed`, `failed`, `compile_error`, `runtime_error`, `timeout`), metrics (duration, memory), tabbed test case viewer, and hidden test masking indicators.
- Real-time Socket.IO listeners in `useInterviewSocket` for `submission:queued`, `submission:completed`, and `submission:failed` with polling fallback.
- Test runner integration in `InterviewRoomPage` and `SubmissionPanel`.

### Verification

- 107 monorepo automated tests passing across `@platform/shared`, `@platform/api`, `@platform/web`, and `@platform/worker`.
- Zero TypeScript (`tsc -b`) and ESLint (`--max-warnings=0`) errors.
- Self-hosted Judge0 deployment guide documented in `docs/JUDGE0_DEPLOYMENT.md`.

## 7. Phase 5 — Live collaboration

### Backend / realtime

- Socket.IO room authorization and presence.
- Yjs provider/service for editor document updates.
- Durable snapshots/update persistence.
- Interview event log.
- Interviewer edit-permission controls.
- Reconnection and state recovery.

### Frontend

- Shared Monaco/Yjs binding.
- Remote cursors and selections.
- Participant list and connection state.
- Chat.
- Interviewer controls and candidate edit lock.

### Tests / exit criteria

- Two browser clients converge to the same document.
- Simultaneous edits do not lose data.
- Unauthorized users cannot join or subscribe.
- Reconnect recovers latest document state.
- Permission changes take effect server-side.
- Realtime event ordering and duplicate handling are tested.

## 8. Phase 6 — Voice, video, and screen sharing

### Backend

- LiveKit room/token service.
- Room-scoped participant grants.
- Verified webhooks.
- Recording consent state and audit events.

### Frontend

- Camera/microphone controls.
- Participant tiles.
- Screen sharing.
- Connection-quality indicators.
- Device selection and permission-error handling.
- Text fallback.

### Tests / exit criteria

- Authorized participants can join the correct media room.
- Expired/incorrect tokens are rejected.
- Cross-interview room access is denied.
- Screen sharing works in supported browsers.
- Reconnect and device permission failures are handled.
- Recording remains disabled unless explicitly enabled and consent requirements are met.

## 9. Phase 7 — Evaluation and audit

### Backend

- Rubric templates and versions.
- Draft and submitted evaluations.
- Evidence references to submissions and interview events.
- Append-only audit events for critical actions.

### Frontend

- Interviewer notes.
- Rubric scoring.
- Evidence-linked evaluation view.
- Final report for authorized organization members.

### Tests / exit criteria

- Candidate cannot access interviewer-only notes.
- Only authorized interviewers can submit evaluations.
- Evaluation changes are auditable.
- Human decision is required; no automatic hiring decision is produced.

## 10. Stage B release gate

Do not call Stage B production-ready until:

- Tenant-isolation tests pass.
- Execution threat model and sandbox review are complete.
- Resource limits and cleanup are verified under load.
- Queue backlog and worker health are observable.
- Realtime reconnect and document recovery are tested.
- Media token authorization is tested.
- Data retention and recording consent policies are documented.
- Backup/restore and incident-response procedures exist.
- Rate limits, security headers, CORS, secrets management, and dependency scanning are configured.

## 11. Stage C — AI interviewer copilot

Build only after Stage B produces reliable structured evidence.

1. Provider abstraction and organization-level AI configuration.
2. JD-to-assessment blueprint draft.
3. Question/follow-up suggestion service.
4. Code failure and complexity explanation.
5. Interview note organization against rubric.
6. Evidence-linked summary draft.
7. Human review, edit, and approval workflow.
8. Audit AI inputs, outputs, model/provider, and reviewer actions.

AI must not decide whether a candidate is hired or rejected. AI-generated content must be labeled as suggestions and traceable to evidence.

## 12. Suggested delivery cadence

Estimate effort only after repository setup and team capacity are known. Prioritize phase exit criteria over calendar promises. A small team should avoid parallelizing tightly coupled features before the API contracts and data model are stable.

For every phase:

- Write/confirm acceptance criteria.
- Implement backend contract.
- Add backend tests.
- Implement frontend flow.
- Add end-to-end tests.
- Update architecture and status documents.
- Demo the working vertical slice.
- Review security and privacy impact before moving on.

---

## Phase 5 — Human evaluation, rubrics and reports (current development scope)

Earlier phase numbers in this plan describe the original roadmap. The implemented
project now labels completed foundation/authentication, assessment/interview,
live collaboration and code execution as Phases 0–4. The evaluation work below
is **Phase 5**, not the old "Phase 7 — Evaluation and audit" roadmap item.

1. **Slice 1, implemented in source; tests not yet run:** Organization-scoped
   reusable rubric model with append-only embedded versions, role permissions,
   strict validation, version conflict detection and archive API. See
   `API_SPECIFICATION.md` section 7 and `DATABASE_SCHEMA.md`.
2. **Slice 2, implemented in frontend source; frontend tests/build not yet run:** organization-level rubric management UI at `/rubrics`, using the existing organization context and Slice 1 API contract. Backend integration remains unverified until Slice 1 runtime acceptance.
3. Slice 3 (not started): evaluator-owned scorecards; freeze one rubric version
   when the **first** scorecard is created; subsequent interview scorecards
   reference that snapshot; validation and draft/submit lifecycle.
4. Slice 4 (not started): scorecard UI.
5. Slice 5 (not started): assignment and multi-interviewer privacy.
6. Slice 6 (not started): final human review and immutable decision history.
7. Slice 7 (not started): allowlisted private, internal and candidate reports.
8. Slice 8 (not started): authorization-checked server-side PDF export.
9. Slice 9 (not started): regression, security verification, infra checks and docs.

Scorecard ownership must not be overridden silently by owners/admins;
reopening/resubmission must produce auditable revisions; stale concurrent
edits must fail rather than overwrite history. Scoring must never treat missing
scores as zero, nor translate numerical summaries into automated decisions.

Dependency installation and live integration verification are required before
any feature can be declared fully verified or production-ready. Email delivery
is still a placeholder; submission aggregate result serialization needs review.

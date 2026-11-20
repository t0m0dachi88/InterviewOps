# API Specification

## 1. API conventions

Base path: `/api/v1`

- JSON request/response bodies.
- Bearer access token for authenticated endpoints.
- Refresh token delivered through a secure, HttpOnly, SameSite cookie where feasible.
- All organization-scoped routes enforce membership and resource authorization.
- Use a consistent error envelope.
- Validate request bodies, params, and query strings.
- Paginate list endpoints with cursor or bounded page-based pagination.
- Use `Idempotency-Key` for submission creation and other retry-sensitive operations.

### Standard success envelope

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

### Standard error envelope

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource was not found",
    "requestId": "req_..."
  }
}
```

Do not return stack traces, secrets, hidden test data, internal container paths, or provider credentials.

## 2. Authentication

| Method | Endpoint             | Purpose                                     |
| ------ | -------------------- | ------------------------------------------- |
| POST   | `/auth/register`     | Create user account                         |
| POST   | `/auth/login`        | Authenticate                                |
| POST   | `/auth/refresh`      | Rotate refresh token                        |
| POST   | `/auth/logout`       | Revoke current refresh-token family/session |
| POST   | `/auth/verify-email` | Verify email                                |
| GET    | `/auth/me`           | Current user profile                        |

## 3. Organizations and memberships

| Method | Endpoint                                         | Purpose                            |
| ------ | ------------------------------------------------ | ---------------------------------- |
| POST   | `/organizations`                                 | Create organization                |
| GET    | `/organizations`                                 | List organizations user belongs to |
| GET    | `/organizations/:organizationId`                 | Organization details               |
| PATCH  | `/organizations/:organizationId`                 | Update organization settings       |
| POST   | `/organizations/:organizationId/invitations`     | Invite interviewer/admin           |
| GET    | `/organizations/:organizationId/members`         | List members                       |
| PATCH  | `/organizations/:organizationId/members/:userId` | Change membership role/status      |
| DELETE | `/organizations/:organizationId/members/:userId` | Remove member                      |
| POST   | `/invitations/:token/accept`                     | Accept invitation                  |

## 4. Interviews, Rooms, and Candidate Invitations

| Method | Endpoint                                         | Purpose                                                       |
| ------ | ------------------------------------------------ | ------------------------------------------------------------- |
| POST   | `/organizations/:organizationId/interviews`      | Create interview                                              |
| GET    | `/organizations/:organizationId/interviews`      | List interviews                                               |
| GET    | `/interviews/:interviewId`                       | Interview detail, role-filtered                               |
| PATCH  | `/interviews/:interviewId`                       | Update scheduled interview                                    |
| POST   | `/interviews/:interviewId/invitations`           | Invite candidate (issues token & candidate invitation)        |
| GET    | `/candidate-invitations/:token`                  | Verify public invitation token without exposing secrets       |
| POST   | `/candidate-invitations/:token/accept`           | Accept invitation & obtain candidate room JWT                 |
| POST   | `/interviews/:interviewId/join-token`            | Exchange invitation secret for scoped candidate room JWT      |
| GET    | `/interviews/:interviewId/room`                  | Get interview room state with candidate-safe question snapshots|
| POST   | `/interviews/:interviewId/room/join`             | Join interview room                                           |
| POST   | `/interviews/:interviewId/room/leave`            | Leave interview room                                          |
| GET    | `/interviews/:interviewId/active-question`       | Get currently active question snapshot                        |
| PATCH  | `/interviews/:interviewId/active-question`       | Switch active question (interviewer/admin only)               |
| POST   | `/interviews/:interviewId/cancel`                | Cancel interview                                              |
| POST   | `/interviews/:interviewId/start`                 | Start interview (authorized interviewer)                      |
| POST   | `/interviews/:interviewId/end`                   | End interview (authorized interviewer)                        |

Candidate invitation links contain an opaque, expiring secret. The server stores only its SHA-256 hash and exchanges it for a short-lived `candidate_room` JWT upon acceptance or join-token request. Permanent access credentials are never exposed in URLs.

## 5. Questions

| Method | Endpoint                                         | Purpose                                 |
| ------ | ------------------------------------------------ | --------------------------------------- |
| POST   | `/organizations/:organizationId/questions`       | Create question                         |
| GET    | `/organizations/:organizationId/questions`       | List questions                          |
| GET    | `/questions/:questionId`                         | Role-filtered question detail           |
| PATCH  | `/questions/:questionId`                         | Create/update a question version        |
| POST   | `/interviews/:interviewId/questions`             | Attach question snapshot                |
| DELETE | `/interviews/:interviewId/questions/:questionId` | Detach question before interview starts |

Candidate-facing question DTOs strictly exclude hidden test cases and expected outputs. Execution workers obtain hidden test data through an internal path in Phase 4.

## 6. Submissions (Phase 3 — No Code Execution)

| Method | Endpoint                                                     | Purpose                                                        |
| ------ | ------------------------------------------------------------ | -------------------------------------------------------------- |
| POST   | `/interviews/:interviewId/questions/:questionId/submissions` | Create draft (`saved`) or immutable submission (`submitted`)   |
| GET    | `/interviews/:interviewId/questions/:questionId/submissions` | List submission history for question (candidate-isolated)     |
| GET    | `/submissions/:submissionId`                                 | Get immutable submission snapshot details                     |

### Submission request

```http
POST /api/v1/interviews/{interviewId}/questions/{questionId}/submissions
Authorization: Bearer <access-token-or-candidate-room-token>
Idempotency-Key: <optional-unique-client-generated-key>
Content-Type: application/json
```

```json
{
  "language": "python",
  "sourceCode": "def solution():\n    return 42",
  "documentVersion": 3,
  "submissionType": "run", // "run" (evaluates public tests) or "submit" (evaluates public + hidden tests)
  "status": "saved" // optional: pass "saved" to save a draft snapshot without execution
}
```

### Submission response

```json
{
  "success": true,
  "data": {
    "submission": {
      "id": "673f8a9...",
      "interviewId": "673f8a0...",
      "questionId": "673f8a1...",
      "questionVersion": 1,
      "language": "python",
      "sourceCode": "def solution():\n    return 42",
      "documentVersion": 3,
      "submissionType": "run",
      "status": "queued",
      "sequenceNumber": 1,
      "submittedBy": {
        "id": "cand_...",
        "name": "Jane Candidate",
        "role": "candidate"
      },
      "executionResult": {
        "status": "queued",
        "passedCount": 0,
        "failedCount": 0,
        "totalCount": 2,
        "durationMs": 0,
        "peakMemoryKb": 0,
        "compileOutput": "",
        "stderr": "",
        "stdout": "",
        "testResults": []
      },
      "createdAt": "2026-11-20T00:00:00.000Z"
    },
    "message": "Code run enqueued for execution."
  }
}
```

### Submission status polling endpoint

```http
GET /api/v1/submissions/{submissionId}/status
Authorization: Bearer <access-token-or-candidate-room-token>
```

Response:
```json
{
  "success": true,
  "data": {
    "id": "673f8a9...",
    "status": "completed",
    "submissionType": "run",
    "executionResult": {
      "status": "passed",
      "passedCount": 2,
      "failedCount": 0,
      "totalCount": 2,
      "durationMs": 52,
      "peakMemoryKb": 14200,
      "compileOutput": "",
      "stderr": "",
      "stdout": "program output",
      "errorMessage": "",
      "executedAt": "2026-11-20T00:00:02.000Z",
      "testResults": [
        {
          "testIndex": 1,
          "visibility": "public",
          "status": "passed",
          "passed": true,
          "input": "2 3",
          "expectedOutput": "5",
          "actualOutput": "5",
          "durationMs": 24,
          "memoryKb": 13900
        }
      ]
    }
  }
}
```

Security note: For candidate requests, hidden test cases omit `input`, `expectedOutput`, `actualOutput`, `compileOutput`, and `stderr` entirely. For interviewers and organization administrators, all fields are populated. Rate limiting: 30 submissions per minute per user/interview. Max source size: 128 KB. Output buffers truncated to 64 KB. Wall-clock execution timeout enforced at 2.0s.

## 7. Rubric management — Phase 5 Slice 1 (implemented)

All routes start with `/api/v1/organizations/:organizationId` and require
an authenticated active member of the organization. Owner/admin can manage;
interviewers can view rubrics. Unauthorized organization IDs return 404.

| Method | Route | Access | Behavior |
| --- | --- | --- | --- |
| POST | `/rubrics` | owner/admin | Create version 1; 201 |
| GET | `/rubrics?status=active&page=1&limit=20` | member | List latest versions; status active/archived/all |
| GET | `/rubrics/:rubricId?version=1` | member | Get specific immutable version or current |
| GET | `/rubrics/:rubricId/versions` | member | List version metadata |
| PATCH | `/rubrics/:rubricId` | owner/admin | Full replacement version, requires `expectedVersion` |
| POST | `/rubrics/:rubricId/versions` | owner/admin | Alias for full replacement new version |
| POST | `/rubrics/:rubricId/archive` | owner/admin | Archive; prevents future versions |

Create/full replacement body (strict allowlist):

```json
{
  "name": "Software Engineering",
  "description": "Technical evaluation",
  "jobRole": "Software Engineer",
  "assessmentId": null,
  "scale": { "min": 1, "max": 5, "labels": { "1": "Poor", "5": "Excellent" } },
  "criteria": [
    { "key": "problem_solving", "label": "Problem Solving", "description": "", "required": true, "weight": 2 },
    { "key": "communication", "label": "Communication", "required": false, "weight": 0 }
  ],
  "changeSummary": "Initial rubric"
}
```

The `scale` defaults to 1–5 if omitted. On PATCH or POST `/versions`, pass
**all** rubric fields and integer `expectedVersion` equal to current version.
Stale versions and archived edits return HTTP 409. Zero weights are accepted
but **at least one criterion must have a positive weight**. Existing assessments
must belong to the same organization. Responses use standard success/error
envelopes and pagination metadata. Unrecognized body fields are rejected.

**Future evaluation endpoints** (not implemented yet): per-interviewer scorecards,
review/finalization, and candidate-safe/internal report generation. Earlier
`/interviews/:id/evaluation` draft endpoints were aspirational and must not be
mistaken for working APIs.

## 8. Media / LiveKit

| Method | Endpoint                                     | Purpose                                                       |
| ------ | -------------------------------------------- | ------------------------------------------------------------- |
| POST   | `/interviews/:interviewId/livekit/token`     | Issue scoped LiveKit token with role-based room grants        |
| POST   | `/webhooks/livekit`                          | Receive verified LiveKit webhook (deferred to Stage C)        |
| POST   | `/interviews/:interviewId/recording-consent` | Record participant consent state                              |

The backend authorizes the participant (team member or candidate) before issuing a LiveKit token.
- Room name: `interview_${interviewId}`.
- Interviewer grants: `roomAdmin: true`, `roomJoin: true`, `canPublish: true`, `canSubscribe: true`.
- Candidate grants: `roomJoin: true`, `canPublish: true`, `canSubscribe: true`.
- Graceful dev fallback: If `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are not configured, returns `isLiveKitConfigured: false` without failing.

## 9. Realtime events & Yjs Collaboration

Socket.IO is mounted at the root HTTP server.

### Authentication & Handshake

Client connects passing `auth: { token: "<access_token_or_candidate_room_token>", interviewId: "<id>" }`.
- Verified against active user session in DB for team members.
- Verified against candidate room JWT signature for candidates.
- Unauthenticated or unauthorized connection requests are immediately rejected during handshake.

### Room & Presence Events

| Event (Client -> Server) | Purpose                        | Payload                                         |
| ------------------------ | ------------------------------ | ----------------------------------------------- |
| `interview:join`         | Join room and announce presence| `{ interviewId }`                               |
| `interview:leave`        | Leave room                     | `{ interviewId }`                               |

| Event (Server -> Client)       | Purpose                           | Payload                                                 |
| ------------------------------ | --------------------------------- | ------------------------------------------------------- |
| `interview:participant_joined` | Broadcast on participant join     | `{ participant: { id, name, role }, participants }`     |
| `interview:participant_left`   | Broadcast on participant leave    | `{ participant: { id, name, role }, participants }`     |
| `interview:room_state`         | Presence snapshot on room join    | `{ participants: [...] }`                               |
| `interview:active_question_changed` | Synchronized question switch | `{ activeQuestionId, changedBy }`                      |
| `submission:saved`             | Draft code saved notification     | `{ submissionId, sequenceNumber, language, timestamp }` |
| `submission:queued`            | Execution job queued              | `{ submissionId, sequenceNumber, language, submissionType, timestamp }` |
| `submission:completed`         | Execution finished successfully   | `{ submissionId, executionResult (sanitized for candidates), timestamp }` |
| `submission:failed`            | Execution failed / error          | `{ submissionId, error, timestamp }`                    |

### Yjs Collaboration Protocol

Real-time code editing synchronizes through a scoped binary/base64 Yjs channel per question:

| Event                         | Direction       | Payload                                                    |
| ----------------------------- | --------------- | ---------------------------------------------------------- |
| `yjs:join`                    | Client -> Server| `{ interviewId, questionId }`                              |
| `yjs:sync`                    | Server -> Client| `{ questionId, update: "<base64_encoded_yjs_state>" }`     |
| `yjs:update`                  | Bidirectional   | `{ interviewId, questionId, update: "<base64_update>" }`   |
| `yjs:awareness`               | Bidirectional   | `{ interviewId, questionId, awareness: "<base64_state>" }` |
| `yjs:reset`                   | Client -> Server| `{ interviewId, questionId }` (interviewer/admin only)     |

Server loads durable state from `CodeDocument` collection in MongoDB, seeds default starter code if first visit, applies incoming updates to an in-memory `Y.Doc`, broadcasts differential updates to room peers, and persists document updates to MongoDB using a 1.5s debounce.

## 10. Security and validation requirements

- Apply authentication middleware before organization/resource authorization.
- Check role and ownership on every route and socket event.
- Validate ObjectId format and resource ownership.
- Limit request body sizes and source-code size.
- Allowlist languages and execution profiles.
- Sanitize/limit stdout and stderr.
- Rate-limit login, invitation, join-token, and submission endpoints.
- Use CORS allowlists and secure headers.
- Protect webhook endpoints with signature verification.
- Never expose hidden test fields through generic Mongoose serialization.
- Do not trust `userId`, `role`, `organizationId`, or `candidateId` supplied by clients.
- Return 404 for inaccessible resources where that reduces resource enumeration.

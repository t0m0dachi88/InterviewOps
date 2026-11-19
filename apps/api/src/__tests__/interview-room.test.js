import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import app from "../app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "../test/db.js";
import { signCandidateRoomToken } from "../modules/auth/token.service.js";

async function createTestUser({ name, email, password = "Password123!" }) {
  const res = await request(app).post("/api/v1/auth/register").send({
    name,
    email,
    password,
  });
  return {
    user: res.body.data.user,
    token: res.body.data.accessToken,
  };
}

async function createTestOrg(ownerToken, name = "HirePulse Test") {
  const res = await request(app)
    .post("/api/v1/organizations")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name });
  return res.body.data.organization;
}

async function inviteMember(ownerToken, orgId, email, role = "interviewer") {
  const inviteRes = await request(app)
    .post(`/api/v1/organizations/${orgId}/invitations`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ email, role });
  return inviteRes.body.data;
}

async function acceptMemberInvite(token, userToken) {
  const res = await request(app)
    .post("/api/v1/invitations/accept")
    .set("Authorization", `Bearer ${userToken}`)
    .send({ token });
  return res.body.data;
}

async function createQuestion(token, orgId, title) {
  const res = await request(app)
    .post(`/api/v1/organizations/${orgId}/questions`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title,
      difficulty: "medium",
      statement: `Solve problem: ${title}`,
      starterCodeByLanguage: {
        javascript: "function solution() { return true; }",
        python: "def solution(): return True",
      },
      publicTests: [{ input: "1", expectedOutput: "1" }],
      hiddenTests: [{ input: "2", expectedOutput: "2" }],
    });
  return res.body.data.question;
}

describe("Interview Room Foundation & Authorization (/api/v1/interviews/:interviewId/room)", () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  it("allows organization owner and assigned interviewer to enter the room, but forbids unassigned interviewer", async () => {
    const owner = await createTestUser({ name: "Owner User", email: "owner@test.com" });
    const org = await createTestOrg(owner.token);

    const interviewer1 = await createTestUser({ name: "Assigned Interviewer", email: "assigned@test.com" });
    const inv1 = await inviteMember(owner.token, org.id, "assigned@test.com", "interviewer");
    await acceptMemberInvite(inv1.debugToken, interviewer1.token);

    const interviewer2 = await createTestUser({ name: "Unassigned Interviewer", email: "unassigned@test.com" });
    const inv2 = await inviteMember(owner.token, org.id, "unassigned@test.com", "interviewer");
    await acceptMemberInvite(inv2.debugToken, interviewer2.token);

    const question = await createQuestion(owner.token, org.id, "Reverse String");

    // Create interview assigned only to interviewer1
    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Frontend Engineering Interview",
        candidate: { name: "Alice Candidate", email: "alice@candidate.com" },
        interviewerIds: [interviewer1.user.id],
        questions: [{ questionId: question.id, questionVersion: 1 }],
      });
    const interviewId = interviewRes.body.data.interview.id;

    // 1. Owner can access room
    const ownerRoomRes = await request(app)
      .get(`/api/v1/interviews/${interviewId}/room`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(ownerRoomRes.status).toBe(200);
    expect(ownerRoomRes.body.data.participant.role).toBe("owner");
    expect(ownerRoomRes.body.data.permissions.canNavigateQuestions).toBe(true);

    // 2. Assigned interviewer can access room
    const assignedRoomRes = await request(app)
      .get(`/api/v1/interviews/${interviewId}/room`)
      .set("Authorization", `Bearer ${interviewer1.token}`);
    expect(assignedRoomRes.status).toBe(200);
    expect(assignedRoomRes.body.data.participant.role).toBe("interviewer");
    expect(assignedRoomRes.body.data.permissions.isInterviewer).toBe(true);

    // 3. Unassigned interviewer is rejected with 403 FORBIDDEN
    const unassignedRoomRes = await request(app)
      .get(`/api/v1/interviews/${interviewId}/room`)
      .set("Authorization", `Bearer ${interviewer2.token}`);
    expect(unassignedRoomRes.status).toBe(403);
    expect(unassignedRoomRes.body.error.code).toBe("FORBIDDEN");
  });

  it("candidate with valid invitation token can accept and access interview room, while cross-interview candidate is rejected", async () => {
    const owner = await createTestUser({ name: "Tech Lead", email: "lead@test.com" });
    const org = await createTestOrg(owner.token);
    const question = await createQuestion(owner.token, org.id, "Two Sum");

    // Create Interview A
    const interviewARes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Interview A",
        candidate: { name: "Bob Candidate", email: "bob@candidate.com" },
        interviewerIds: [owner.user.id],
        questions: [{ questionId: question.id, questionVersion: 1 }],
      });
    const interviewAId = interviewARes.body.data.interview.id;

    // Create Interview B
    const interviewBRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Interview B",
        candidate: { name: "Charlie Candidate", email: "charlie@candidate.com" },
        interviewerIds: [owner.user.id],
        questions: [{ questionId: question.id, questionVersion: 1 }],
      });
    const interviewBId = interviewBRes.body.data.interview.id;

    // Invite Bob to Interview A
    const inviteRes = await request(app)
      .post(`/api/v1/interviews/${interviewAId}/invitations`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        candidateName: "Bob Candidate",
        candidateEmail: "bob@candidate.com",
      });
    expect(inviteRes.status).toBe(201);
    const rawToken = inviteRes.body.data.rawToken;

    // Accept Bob's invitation and retrieve room token
    const acceptRes = await request(app)
      .post(`/api/v1/candidate-invitations/${rawToken}/accept`)
      .send();
    expect(acceptRes.status).toBe(200);
    const candidateRoomToken = acceptRes.body.data.roomToken;
    expect(candidateRoomToken).toBeDefined();

    // Bob accesses Interview A room
    const roomRes = await request(app)
      .get(`/api/v1/interviews/${interviewAId}/room`)
      .set("Authorization", `Bearer ${candidateRoomToken}`);
    expect(roomRes.status).toBe(200);
    expect(roomRes.body.data.participant.role).toBe("candidate");
    expect(roomRes.body.data.participant.isCandidate).toBe(true);
    expect(roomRes.body.data.permissions.canNavigateQuestions).toBe(false);

    // Hidden test cases MUST be stripped for candidate!
    expect(roomRes.body.data.questions[0].publicTests).toBeDefined();
    expect(roomRes.body.data.questions[0].hiddenTests).toBeUndefined();

    // Bob cannot access Interview B room with Interview A's token!
    const crossAccessRes = await request(app)
      .get(`/api/v1/interviews/${interviewBId}/room`)
      .set("Authorization", `Bearer ${candidateRoomToken}`);
    expect(crossAccessRes.status).toBe(403);
    expect(crossAccessRes.body.error.code).toBe("FORBIDDEN");
  });

  it("handles active question synchronization and prevents candidate from modifying question", async () => {
    const owner = await createTestUser({ name: "Host Lead", email: "host@test.com" });
    const org = await createTestOrg(owner.token);
    const q1 = await createQuestion(owner.token, org.id, "Question One");
    const q2 = await createQuestion(owner.token, org.id, "Question Two");

    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Multi-Question Interview",
        candidate: { name: "Eve Candidate", email: "eve@test.com" },
        interviewerIds: [owner.user.id],
        questions: [
          { questionId: q1.id, questionVersion: 1 },
          { questionId: q2.id, questionVersion: 1 },
        ],
      });
    const interviewId = interviewRes.body.data.interview.id;

    const candidateToken = signCandidateRoomToken({
      interviewId,
      candidateEmail: "eve@test.com",
      candidateName: "Eve Candidate",
    });

    // Initial active question defaults to q1
    const activeQRes = await request(app)
      .get(`/api/v1/interviews/${interviewId}/active-question`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(activeQRes.status).toBe(200);
    expect(activeQRes.body.data.activeQuestionId).toBe(q1.id);

    // Candidate attempts to switch active question -> 403 Forbidden
    const candidateSwitchRes = await request(app)
      .patch(`/api/v1/interviews/${interviewId}/active-question`)
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({ questionId: q2.id });
    expect(candidateSwitchRes.status).toBe(403);

    // Interviewer switches active question to q2 -> 200 OK
    const interviewerSwitchRes = await request(app)
      .patch(`/api/v1/interviews/${interviewId}/active-question`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ questionId: q2.id });
    expect(interviewerSwitchRes.status).toBe(200);
    expect(interviewerSwitchRes.body.data.activeQuestionId).toBe(q2.id);

    // Candidate verifies current active question is now q2
    const candidateActiveQRes = await request(app)
      .get(`/api/v1/interviews/${interviewId}/active-question`)
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(candidateActiveQRes.status).toBe(200);
    expect(candidateActiveQRes.body.data.activeQuestionId).toBe(q2.id);
  });

  it("prevents entering a cancelled interview", async () => {
    const owner = await createTestUser({ name: "Canceller", email: "canceller@test.com" });
    const org = await createTestOrg(owner.token);
    const q1 = await createQuestion(owner.token, org.id, "Cancelled Problem");

    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Cancelled Interview",
        candidate: { name: "Cancelled Candidate", email: "cancel@test.com" },
        interviewerIds: [owner.user.id],
        questions: [{ questionId: q1.id, questionVersion: 1 }],
      });
    const interviewId = interviewRes.body.data.interview.id;

    // Cancel interview
    await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews/${interviewId}/cancel`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ reason: "Candidate withdrew" });

    // Attempt to enter room -> rejected
    const roomRes = await request(app)
      .get(`/api/v1/interviews/${interviewId}/room`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(roomRes.status).toBe(400);
    expect(roomRes.body.error.code).toBe("INVALID_STATUS_TRANSITION");
  });
});

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

async function createTestOrg(ownerToken, name = "HirePulse LiveKit Org") {
  const res = await request(app)
    .post("/api/v1/organizations")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name });
  return res.body.data.organization;
}

describe("LiveKit Token Service API (/api/v1/interviews/:interviewId/livekit/token)", () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  it("issues scoped LiveKit token to authorized interviewer with admin privileges", async () => {
    const owner = await createTestUser({ name: "LiveKit Host", email: "host@lk.com" });
    const org = await createTestOrg(owner.token);

    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Video Interview",
        candidate: { name: "Video Candidate", email: "video@candidate.com" },
        interviewerIds: [owner.user.id],
      });
    const interviewId = interviewRes.body.data.interview.id;

    const tokenRes = await request(app)
      .post(`/api/v1/interviews/${interviewId}/livekit/token`)
      .set("Authorization", `Bearer ${owner.token}`);

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.data.token).toBeDefined();
    expect(tokenRes.body.data.roomName).toBe(`interview_${interviewId}`);
    expect(tokenRes.body.data.serverUrl).toBeDefined();
    // Secret should NEVER be in response!
    expect(tokenRes.body.data.secret).toBeUndefined();
    expect(tokenRes.body.data.apiSecret).toBeUndefined();
  });

  it("issues scoped LiveKit token to authorized candidate without admin privileges", async () => {
    const owner = await createTestUser({ name: "Host 2", email: "host2@lk.com" });
    const org = await createTestOrg(owner.token);

    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Candidate Video Session",
        candidate: { name: "Grace Candidate", email: "grace@test.com" },
        interviewerIds: [owner.user.id],
      });
    const interviewId = interviewRes.body.data.interview.id;

    const candidateToken = signCandidateRoomToken({
      interviewId,
      candidateEmail: "grace@test.com",
      candidateName: "Grace Candidate",
    });

    const tokenRes = await request(app)
      .post(`/api/v1/interviews/${interviewId}/livekit/token`)
      .set("Authorization", `Bearer ${candidateToken}`);

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.data.token).toBeDefined();
    expect(tokenRes.body.data.roomName).toBe(`interview_${interviewId}`);
  });

  it("rejects unauthorized participant attempting to generate token", async () => {
    const owner = await createTestUser({ name: "Host 3", email: "host3@lk.com" });
    const org = await createTestOrg(owner.token);

    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Private Video Session",
        candidate: { name: "Private Candidate", email: "private@test.com" },
        interviewerIds: [owner.user.id],
      });
    const interviewId = interviewRes.body.data.interview.id;

    const stranger = await createTestUser({ name: "Stranger", email: "stranger@other.com" });

    const tokenRes = await request(app)
      .post(`/api/v1/interviews/${interviewId}/livekit/token`)
      .set("Authorization", `Bearer ${stranger.token}`);

    expect(tokenRes.status).toBe(403);
  });
});

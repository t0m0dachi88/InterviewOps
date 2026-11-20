import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "../test/db.js";
import { EvaluationRubric } from "../modules/rubrics/rubric.model.js";
import { OrganizationMembership } from "../modules/organizations/membership.model.js";

const rubricContent = (name = "Technical rubric") => ({
  name,
  criteria: [
    { key: "reasoning", label: "Reasoning", weight: 2, required: true },
    { key: "communication", label: "Communication", weight: 0, required: false },
  ],
});

async function register(email) {
  const res = await request(app).post("/api/v1/auth/register")
    .send({ name: "Verifier", email, password: "Password123!" });
  expect(res.status).toBe(201);
  return { token: res.body.data.accessToken, userId: res.body.data.user.id };
}
async function organization(actor, name) {
  const res = await request(app).post("/api/v1/organizations")
    .set("Authorization", `Bearer ${actor.token}`).send({ name });
  expect(res.status).toBe(201);
  return res.body.data.organization.id;
}
async function join(actor, orgId, role, status = "active") {
  return OrganizationMembership.create({ organizationId: orgId, userId: actor.userId, role, status });
}
function api(actor, orgId, suffix = "") {
  const path = `/api/v1/organizations/${orgId}/rubrics${suffix}`;
  const agent = request(app);
  return {
    get: () => agent.get(path).set("Authorization", `Bearer ${actor.token}`),
    post: (body) => agent.post(path).set("Authorization", `Bearer ${actor.token}`).send(body),
    patch: (body) => agent.patch(path).set("Authorization", `Bearer ${actor.token}`).send(body),
  };
}
async function create(actor, orgId) {
  const res = await api(actor, orgId).post(rubricContent());
  expect(res.status).toBe(201);
  return res.body.data.rubric.id;
}

// Real HTTP requests and real Mongoose reads/writes against mongodb-memory-server.
// No database mocks, fake model results, or simulated concurrency.
describe("Slice 1 acceptance: database-backed rubric verification", () => {
  beforeAll(connectTestDb);
  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  it("allows owner to create/read/update/archive while enforcing authorization on each request", async () => {
    const owner = await register("owner-rubric-verify@test.com");
    const orgId = await organization(owner, "Ownership Verification");
    const id = await create(owner, orgId);
    expect((await api(owner, orgId, `/${id}`).get()).status).toBe(200);
    expect((await api(owner, orgId, `/${id}`).patch({ ...rubricContent("New"), expectedVersion: 1 })).status).toBe(200);
    expect((await api(owner, orgId, `/${id}/archive`).post({})).status).toBe(200);
  });

  it("allows admin to manage rubrics but an interviewer to read only, regardless of interview assignment", async () => {
    const owner = await register("owner-admin-test@test.com");
    const admin = await register("admin-role-test@test.com");
    const interviewer = await register("unassigned-role-test@test.com");
    const orgId = await organization(owner, "Roles Verification");
    await join(admin, orgId, "admin");
    await join(interviewer, orgId, "interviewer");
    const id = await create(admin, orgId);
    expect((await api(admin, orgId, `/${id}`).patch({ ...rubricContent("Admin change"), expectedVersion: 1 })).status).toBe(200);
    expect((await api(interviewer, orgId).get()).status).toBe(200);
    expect((await api(interviewer, orgId, `/${id}`).get()).status).toBe(200);
    expect((await api(interviewer, orgId, `/${id}/versions`).get()).status).toBe(200);
    expect((await api(interviewer, orgId).post(rubricContent("Forbidden"))).status).toBe(403);
    expect((await api(interviewer, orgId, `/${id}`).patch({ ...rubricContent(), expectedVersion: 2 })).status).toBe(403);
    expect((await api(interviewer, orgId, `/${id}/versions`).post({ ...rubricContent(), expectedVersion: 2 })).status).toBe(403);
    expect((await api(interviewer, orgId, `/${id}/archive`).post({})).status).toBe(403);
    expect((await api(admin, orgId, `/${id}/archive`).post({})).status).toBe(200);
  });

  it("rejects missing and suspended memberships, anonymous requests, and invalid organization IDs", async () => {
    const owner = await register("owner-membership@test.com");
    const outsider = await register("outsider-membership@test.com");
    const suspended = await register("suspended-membership@test.com");
    const orgId = await organization(owner, "Membership Verification");
    const id = await create(owner, orgId);
    await join(suspended, orgId, "admin", "suspended");
    expect((await api(outsider, orgId).get()).status).toBe(404);
    expect((await api(suspended, orgId, `/${id}`).get()).status).toBe(404);
    expect((await api(outsider, orgId).post(rubricContent())).status).toBe(404);
    expect((await api(owner, "not-an-object-id").get()).status).toBe(404);
    expect((await request(app).get(`/api/v1/organizations/${orgId}/rubrics/${id}`)).status).toBe(401);
    expect((await request(app).post(`/api/v1/organizations/${orgId}/rubrics`).send(rubricContent())).status).toBe(401);
  });

  it("prevents cross-tenant reads and writes, even with a valid record ID and client-chosen organization ID", async () => {
    const ownerA = await register("tenant-a-verify@test.com");
    const ownerB = await register("tenant-b-verify@test.com");
    const orgA = await organization(ownerA, "Tenant A Verification");
    const orgB = await organization(ownerB, "Tenant B Verification");
    const idA = await create(ownerA, orgA);
    expect((await api(ownerB, orgA, `/${idA}`).get()).status).toBe(404);
    expect((await api(ownerB, orgB, `/${idA}`).get()).status).toBe(404);
    expect((await api(ownerB, orgB, `/${idA}`).patch({ ...rubricContent(), expectedVersion: 1 })).status).toBe(404);
    expect((await api(ownerB, orgB, `/${idA}/archive`).post({})).status).toBe(404);
    expect((await api(ownerA, orgB, `/${idA}`).get()).status).toBe(404);
    expect((await EvaluationRubric.findById(idA)).currentVersion).toBe(1);
  });

  it("permits precisely one of two simultaneous version updates and rejects the other with HTTP 409", async () => {
    const owner = await register("race-owner@test.com");
    const orgId = await organization(owner, "Concurrency Verification");
    const id = await create(owner, orgId);
    const [a, b] = await Promise.all([
      api(owner, orgId, `/${id}`).patch({ ...rubricContent("Race A"), expectedVersion: 1 }),
      api(owner, orgId, `/${id}/versions`).post({ ...rubricContent("Race B"), expectedVersion: 1 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const stored = await EvaluationRubric.findById(id).lean();
    expect(stored.currentVersion).toBe(2);
    expect(stored.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(stored.versions[0].name).toBe("Technical rubric");
    expect(["Race A", "Race B"]).toContain(stored.versions[1].name);
  });

  it("preserves all historical version fields after multiple edits and an archive", async () => {
    const owner = await register("historical-owner@test.com");
    const orgId = await organization(owner, "History Verification");
    const id = await create(owner, orgId);
    const original = (await EvaluationRubric.findById(id).lean()).versions[0];
    for (let v = 1; v <= 4; v++) {
      const response = await api(owner, orgId, `/${id}/versions`).post({ ...rubricContent(`Version ${v + 1}`), expectedVersion: v });
      expect(response.status).toBe(200);
      expect(response.body.data.rubric.currentVersion).toBe(v + 1);
    }
    expect((await api(owner, orgId, `/${id}?version=1`).get()).body.data.rubric.name).toBe("Technical rubric");
    expect((await api(owner, orgId, `/${id}?version=5`).get()).body.data.rubric.name).toBe("Version 5");
    expect((await api(owner, orgId, `/${id}/versions`).get()).body.data.versions).toHaveLength(5);
    expect((await api(owner, orgId, `/${id}/archive`).post({})).status).toBe(200);
    const stored = await EvaluationRubric.findById(id).lean();
    expect(stored.versions).toHaveLength(5);
    expect(stored.versions[0]).toEqual(original);
    expect(stored.versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5]);
    expect((await api(owner, orgId, `/${id}/versions`).get()).status).toBe(200);
    expect((await api(owner, orgId, `/${id}`).patch({ ...rubricContent("Nope"), expectedVersion: 5 })).status).toBe(409);
    expect((await api(owner, orgId, `/${id}/versions`).post({ ...rubricContent("Nope"), expectedVersion: 5 })).status).toBe(409);
    expect((await EvaluationRubric.findById(id).lean()).versions[0]).toEqual(original);
  });

  it("never permits an old version reference to overwrite an historical version", async () => {
    const owner = await register("stale-history@test.com");
    const orgId = await organization(owner, "Stale Reference Verification");
    const id = await create(owner, orgId);
    expect((await api(owner, orgId, `/${id}`).patch({ ...rubricContent("Version 2"), expectedVersion: 1 })).status).toBe(200);
    expect((await api(owner, orgId, `/${id}`).patch({ ...rubricContent("Old write"), expectedVersion: 1 })).status).toBe(409);
    expect((await api(owner, orgId, `/${id}?version=1`).get()).body.data.rubric.name).toBe("Technical rubric");
    expect((await EvaluationRubric.findById(id)).versions).toHaveLength(2);
  });

  it("creates the declared MongoDB indexes, not merely Mongoose schema definitions", async () => {
    await EvaluationRubric.createIndexes();
    const indexes = await EvaluationRubric.collection.indexes();
    const contains = (key) => indexes.some((index) => JSON.stringify(index.key) === JSON.stringify(key));
    expect(contains({ organizationId: 1, status: 1, updatedAt: -1 })).toBe(true);
    expect(contains({ organizationId: 1, _id: 1 })).toBe(true);
  });

  it("rejects malformed IDs, invalid version queries and bodies without modifying the database", async () => {
    const owner = await register("invalid-input-verify@test.com");
    const orgId = await organization(owner, "Validation Verification");
    const id = await create(owner, orgId);
    const invalidCreates = [
      { ...rubricContent(), criteria: [{ key: "duplicate", label: "One" }, { key: "duplicate", label: "Two" }] },
      { ...rubricContent(), criteria: [{ key: "key", label: "X", weight: -1 }] },
      { ...rubricContent(), scale: { min: 5, max: 1 } },
      { ...rubricContent(), assessmentId: "not-a-valid-id" },
      { ...rubricContent(), unknownField: true },
      { ...rubricContent(), criteria: [] },
      { ...rubricContent(), criteria: [{ key: "zero", label: "Zero", weight: 0 }] },
    ];
    for (const body of invalidCreates) expect((await api(owner, orgId).post(body)).status).toBe(400);
    expect((await api(owner, orgId, "/not-an-object-id").get()).status).toBe(404);
    expect((await api(owner, orgId, `/${id}?version=nope`).get()).status).toBe(400);
    expect((await api(owner, orgId, `/${id}?version=0`).get()).status).toBe(400);
    expect((await api(owner, orgId, `/${id}?version=1000`).get()).status).toBe(404);
    expect((await api(owner, orgId, `/${id}`).patch({ ...rubricContent(), expectedVersion: "1" })).status).toBe(400);
    expect((await api(owner, orgId, `/${id}`).patch({ ...rubricContent(), expectedVersion: 0 })).status).toBe(400);
    expect((await api(owner, orgId, `/${id}`).patch({ ...rubricContent(), expectedVersion: 1, unexpected: true })).status).toBe(400);
    expect((await EvaluationRubric.findById(id)).currentVersion).toBe(1);
    expect(await EvaluationRubric.countDocuments({ organizationId: orgId })).toBe(1);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import app from "../app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "../test/db.js";
import { EvaluationRubric } from "../modules/rubrics/rubric.model.js";
import { OrganizationMembership } from "../modules/organizations/membership.model.js";

const content = (name = "Technical Interview") => ({
  name, description: "Structured interview rubric", jobRole: "Backend Engineer",
  criteria: [
    { key: "problem_solving", label: "Problem solving", required: true, weight: 2 },
    { key: "communication", label: "Communication", required: false, weight: 0 },
  ],
});
async function user(email) {
  const response = await request(app).post("/api/v1/auth/register").send({ name: "Test Person", email, password: "Password123!" });
  expect(response.status).toBe(201);
  return { id: response.body.data.user.id, token: response.body.data.accessToken };
}
async function org(token, name) {
  const response = await request(app).post("/api/v1/organizations").set("Authorization", `Bearer ${token}`).send({ name });
  expect(response.status).toBe(201);
  return response.body.data.organization.id;
}
function call(method, token, organizationId, suffix = "") {
  return request(app)[method](`/api/v1/organizations/${organizationId}/rubrics${suffix}`).set("Authorization", `Bearer ${token}`);
}

describe("Phase 5 Slice 1: rubric API", () => {
  beforeAll(connectTestDb);
  afterAll(disconnectTestDb);
  beforeEach(clearTestDb);

  it("creates and lists a versioned rubric with zero-weight criterion and default scale", async () => {
    const actor = await user("rubric1@test.com"); const id = await org(actor.token, "Acme Rubrics");
    const response = await call("post", actor.token, id).send(content());
    expect(response.status).toBe(201);
    const rubric = response.body.data.rubric;
    expect(rubric.currentVersion).toBe(1);
    expect(rubric.scale).toMatchObject({ min: 1, max: 5 });
    expect(rubric.criteria[1].weight).toBe(0);
    expect((await EvaluationRubric.findById(rubric.id)).versions).toHaveLength(1);
    const listed = await call("get", actor.token, id);
    expect(listed.status).toBe(200);
    expect(listed.body.data.rubrics).toHaveLength(1);
  });

  it("creates version 2 atomically and preserves unchanged version 1", async () => {
    const actor = await user("rubric2@test.com"); const id = await org(actor.token, "Acme Rubrics");
    const initial = await call("post", actor.token, id).send(content());
    const rubricId = initial.body.data.rubric.id;
    const updated = await call("patch", actor.token, id, `/${rubricId}`).send({ ...content("Revised rubric"), expectedVersion: 1 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.rubric.currentVersion).toBe(2);
    expect((await call("get", actor.token, id, `/${rubricId}?version=1`)).body.data.rubric.name).toBe("Technical Interview");
    expect((await call("get", actor.token, id, `/${rubricId}?version=2`)).body.data.rubric.name).toBe("Revised rubric");
    const stale = await call("patch", actor.token, id, `/${rubricId}`).send({ ...content("Stale"), expectedVersion: 1 });
    expect(stale.status).toBe(409);
    const versions = await call("get", actor.token, id, `/${rubricId}/versions`);
    expect(versions.body.data.versions).toHaveLength(2);
    expect((await EvaluationRubric.findById(rubricId)).versions).toHaveLength(2);
  });

  it("archives a rubric, prevents later versions, and retains historical read access", async () => {
    const actor = await user("rubric3@test.com"); const id = await org(actor.token, "Acme Rubrics");
    const created = await call("post", actor.token, id).send(content());
    const rubricId = created.body.data.rubric.id;
    expect((await call("post", actor.token, id, `/${rubricId}/archive`)).status).toBe(200);
    expect((await call("get", actor.token, id)).body.data.rubrics).toHaveLength(0);
    expect((await call("get", actor.token, id, "?status=archived")).body.data.rubrics).toHaveLength(1);
    expect((await call("post", actor.token, id, `/${rubricId}/versions`).send({ ...content("Too late"), expectedVersion: 1 })).status).toBe(409);
    expect((await call("get", actor.token, id, `/${rubricId}?version=1`)).status).toBe(200);
  });

  it("rejects malformed criteria, duplicate keys, all-zero weights, unknown fields and invalid assessment references", async () => {
    const actor = await user("rubric4@test.com"); const id = await org(actor.token, "Acme Rubrics");
    const bad = [
      { ...content(), criteria: [{ key: "x", label: "X", weight: 0 }] },
      { ...content(), criteria: [{ key: "x", label: "X" }, { key: "x", label: "Duplicate" }] },
      { ...content(), criteria: [{ key: "x", label: "X", weight: -1 }] },
      { ...content(), extraField: "ignore me" },
      { ...content(), assessmentId: "000000000000000000000001" },
      { ...content(), scale: { min: 5, max: 1 } },
      { ...content(), criteria: [] },
    ];
    for (const payload of bad) expect((await call("post", actor.token, id).send(payload)).status).toBe(400);
    expect(await EvaluationRubric.countDocuments({ organizationId: id })).toBe(0);
  });

  it("prevents unauthorized writes, anonymous access and cross-tenant record access", async () => {
    const owner = await user("rubric5@test.com"); const other = await user("rubric6@test.com");
    const orgA = await org(owner.token, "First Organization"); const orgB = await org(other.token, "Other Organization");
    const created = await call("post", owner.token, orgA).send(content());
    const rubricId = created.body.data.rubric.id;
    expect((await call("get", other.token, orgA, `/${rubricId}`)).status).toBe(404);
    expect((await call("get", other.token, orgB, `/${rubricId}`)).status).toBe(404);
    expect((await call("patch", other.token, orgB, `/${rubricId}`).send({ ...content(), expectedVersion: 1 })).status).toBe(404);
    expect((await request(app).get(`/api/v1/organizations/${orgA}/rubrics`)).status).toBe(401);
    await OrganizationMembership.create({ organizationId: orgA, userId: other.id, role: "interviewer", status: "active" });
    expect((await call("get", other.token, orgA, `/${rubricId}`)).status).toBe(200);
    expect((await call("post", other.token, orgA).send(content("Forbidden"))).status).toBe(403);
    expect((await call("post", other.token, orgA, `/${rubricId}/archive`)).status).toBe(403);
  });
});

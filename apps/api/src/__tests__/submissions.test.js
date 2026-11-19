import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import app from "../app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "../test/db.js";
import { signCandidateRoomToken } from "../modules/auth/token.service.js";
import { Submission } from "../modules/submissions/submission.model.js";
import { EXECUTION_STATUS } from "@platform/shared";

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

async function createTestOrg(ownerToken, name = "Interview Ops Submissions Org") {
  const res = await request(app)
    .post("/api/v1/organizations")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name });
  return res.body.data.organization;
}

async function createQuestion(token, orgId, title, options = {}) {
  const res = await request(app)
    .post(`/api/v1/organizations/${orgId}/questions`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title,
      difficulty: "easy",
      statement: `Statement for ${title}`,
      starterCodeByLanguage: {
        javascript: "function solution() {}",
        python: "def solution(): pass",
        cpp: "int solution() { return 0; }",
      },
      publicTests: options.publicTests || [],
      hiddenTests: options.hiddenTests || [],
    });
  return res.body.data.question;
}

describe("Submission Management API (/api/v1/interviews/:interviewId/questions/:questionId/submissions)", () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  it("allows candidate to save and submit code with immutable snapshots and no fake execution", async () => {
    const owner = await createTestUser({ name: "Lead Dev", email: "lead@test.com" });
    const org = await createTestOrg(owner.token);
    const question = await createQuestion(owner.token, org.id, "Fibonacci");

    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Algorithms Interview",
        candidate: { name: "Carol Candidate", email: "carol@test.com" },
        interviewerIds: [owner.user.id],
        questions: [{ questionId: question.id, questionVersion: 1 }],
      });
    const interviewId = interviewRes.body.data.interview.id;

    const candidateToken = signCandidateRoomToken({
      interviewId,
      candidateEmail: "carol@test.com",
      candidateName: "Carol Candidate",
    });

    // 1. Candidate saves draft code
    const saveRes = await request(app)
      .post(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({
        sourceCode: "function fib(n) { return n <= 1 ? n : fib(n-1) + fib(n-2); }",
        language: "javascript",
        documentVersion: 1,
        status: "saved",
      });
    expect(saveRes.status).toBe(201);
    expect(saveRes.body.data.submission.status).toBe("saved");
    expect(saveRes.body.data.submission.sequenceNumber).toBe(1);
    expect(saveRes.body.data.message).toBe("Draft saved successfully.");

    // 2. Candidate submits finalized code (queued for execution)
    const submitRes = await request(app)
      .post(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({
        sourceCode: "function fib(n) { let a=0, b=1; for(let i=0; i<n; i++) [a,b]=[b, a+b]; return a; }",
        language: "javascript",
        documentVersion: 5,
        submissionType: "submit",
      });
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.data.submission.status).toBe("queued");
    expect(submitRes.body.data.submission.sequenceNumber).toBe(2);
    expect(submitRes.body.data.message).toBe("Solution submitted and queued for test evaluation.");

    // 3. List submissions for this question
    const listRes = await request(app)
      .get(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.submissions.length).toBe(2);
    expect(listRes.body.data.submissions[0].sequenceNumber).toBe(2);
    expect(listRes.body.data.submissions[1].sequenceNumber).toBe(1);

    // 4. Retrieve individual submission by ID
    const singleRes = await request(app)
      .get(`/api/v1/submissions/${saveRes.body.data.submission.id}`)
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(singleRes.status).toBe(200);
    expect(singleRes.body.data.submission.sourceCode).toBe(
      "function fib(n) { return n <= 1 ? n : fib(n-1) + fib(n-2); }",
    );
  });

  it("enforces tenant isolation and candidate privacy: candidate cannot view another candidate's submissions", async () => {
    const owner = await createTestUser({ name: "Lead 2", email: "lead2@test.com" });
    const org = await createTestOrg(owner.token);
    const question = await createQuestion(owner.token, org.id, "Binary Search");

    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Engineering Interview",
        candidate: { name: "Dan Candidate", email: "dan@test.com" },
        interviewerIds: [owner.user.id],
        questions: [{ questionId: question.id, questionVersion: 1 }],
      });
    const interviewId = interviewRes.body.data.interview.id;

    const danToken = signCandidateRoomToken({
      interviewId,
      candidateEmail: "dan@test.com",
      candidateName: "Dan Candidate",
    });

    const otherToken = signCandidateRoomToken({
      interviewId,
      candidateEmail: "intruder@test.com",
      candidateName: "Intruder Candidate",
    });

    // Dan saves code
    const saveRes = await request(app)
      .post(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${danToken}`)
      .send({
        sourceCode: "def binary_search(): return -1",
        language: "python",
        status: "saved",
      });
    const danSubmissionId = saveRes.body.data.submission.id;

    // Intruder requests Dan's submission by ID -> 403 Forbidden
    const intruderGetRes = await request(app)
      .get(`/api/v1/submissions/${danSubmissionId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(intruderGetRes.status).toBe(403);

    // Intruder lists submissions -> sees empty list (cannot see Dan's)
    const intruderListRes = await request(app)
      .get(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(intruderListRes.status).toBe(200);
    expect(intruderListRes.body.data.submissions.length).toBe(0);

    // Authorized interviewer can view all submissions
    const interviewerListRes = await request(app)
      .get(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(interviewerListRes.status).toBe(200);
    expect(interviewerListRes.body.data.submissions.length).toBe(1);
    expect(interviewerListRes.body.data.submissions[0].id).toBe(danSubmissionId);
  });

  it("validates language, source code size, and enforces idempotency", async () => {
    const owner = await createTestUser({ name: "Lead 3", email: "lead3@test.com" });
    const org = await createTestOrg(owner.token);
    const question = await createQuestion(owner.token, org.id, "Sorting");

    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Sorting Interview",
        candidate: { name: "Frank Candidate", email: "frank@test.com" },
        interviewerIds: [owner.user.id],
        questions: [{ questionId: question.id, questionVersion: 1 }],
      });
    const interviewId = interviewRes.body.data.interview.id;

    const frankToken = signCandidateRoomToken({
      interviewId,
      candidateEmail: "frank@test.com",
      candidateName: "Frank Candidate",
    });

    // 1. Invalid language
    const invalidLangRes = await request(app)
      .post(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${frankToken}`)
      .send({
        sourceCode: "puts 'hello'",
        language: "ruby",
      });
    expect(invalidLangRes.status).toBe(400);

    // 2. Oversized source code (>128 KB)
    const oversizedCode = "a".repeat(140000);
    const oversizedRes = await request(app)
      .post(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${frankToken}`)
      .send({
        sourceCode: oversizedCode,
        language: "javascript",
      });
    expect(oversizedRes.status).toBe(400);

    // 3. Idempotency test
    const idempotencyKey = "client-unique-key-12345";
    const sub1 = await request(app)
      .post(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${frankToken}`)
      .send({
        sourceCode: "console.log('idempotent');",
        language: "javascript",
        idempotencyKey,
      });
    expect(sub1.status).toBe(201);
    expect(sub1.body.data.isDuplicate).toBe(false);

    // Repeating request with same key returns existing submission (status 200)
    const sub2 = await request(app)
      .post(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${frankToken}`)
      .send({
        sourceCode: "console.log('idempotent');",
        language: "javascript",
        idempotencyKey,
      });
    expect(sub2.status).toBe(200);
    expect(sub2.body.data.isDuplicate).toBe(true);
    expect(sub2.body.data.submission.id).toBe(sub1.body.data.submission.id);
  });

  it("handles 'Run Code' (public tests) and 'Submit Solution' (public + hidden tests)", async () => {
    const owner = await createTestUser({ name: "Runner Lead", email: "runner@test.com" });
    const org = await createTestOrg(owner.token);
    const question = await createQuestion(owner.token, org.id, "Sum Two", {
      publicTests: [
        { input: "1 2", expectedOutput: "3" },
        { input: "5 5", expectedOutput: "10" },
      ],
      hiddenTests: [
        { input: "-1 -1", expectedOutput: "-2" },
        { input: "100 200", expectedOutput: "300" },
      ],
    });

    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Execution Flow Interview",
        candidate: { name: "Grace Candidate", email: "grace@test.com" },
        interviewerIds: [owner.user.id],
        questions: [{ questionId: question.id, questionVersion: 1 }],
      });
    const interviewId = interviewRes.body.data.interview.id;

    const candidateToken = signCandidateRoomToken({
      interviewId,
      candidateEmail: "grace@test.com",
      candidateName: "Grace Candidate",
    });

    // 1. Run Code (submissionType: "run")
    const runRes = await request(app)
      .post(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({
        sourceCode: "console.log(3);",
        language: "javascript",
        submissionType: "run",
      });

    expect(runRes.status).toBe(201);
    expect(runRes.body.data.submission.submissionType).toBe("run");
    expect(runRes.body.data.submission.status).toBe("queued");
    expect(runRes.body.data.submission.executionResult.status).toBe("queued");
    expect(runRes.body.data.submission.executionResult.totalCount).toBe(2); // Only public tests
    expect(runRes.body.data.message).toBe("Code run enqueued for execution.");

    // 2. Submit Solution (submissionType: "submit")
    const submitRes = await request(app)
      .post(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({
        sourceCode: "console.log(3);",
        language: "javascript",
        submissionType: "submit",
      });

    expect(submitRes.status).toBe(201);
    expect(submitRes.body.data.submission.submissionType).toBe("submit");
    expect(submitRes.body.data.submission.status).toBe("queued");
    expect(submitRes.body.data.submission.executionResult.status).toBe("queued");
    expect(submitRes.body.data.submission.executionResult.totalCount).toBe(4); // 2 public + 2 hidden
    expect(submitRes.body.data.message).toBe("Solution submitted and queued for test evaluation.");
  });

  it("strictly enforces candidate privacy: masks hidden test inputs, outputs, and compiler outputs from candidates while revealing them to interviewers", async () => {
    const owner = await createTestUser({ name: "Security Lead", email: "sec@test.com" });
    const org = await createTestOrg(owner.token);
    const question = await createQuestion(owner.token, org.id, "Secret Question", {
      publicTests: [{ input: "public_in", expectedOutput: "public_out" }],
      hiddenTests: [{ input: "super_secret_in", expectedOutput: "super_secret_out" }],
    });

    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Masking Verification Interview",
        candidate: { name: "Heidi Candidate", email: "heidi@test.com" },
        interviewerIds: [owner.user.id],
        questions: [{ questionId: question.id, questionVersion: 1 }],
      });
    const interviewId = interviewRes.body.data.interview.id;

    const candidateToken = signCandidateRoomToken({
      interviewId,
      candidateEmail: "heidi@test.com",
      candidateName: "Heidi Candidate",
    });

    // Create submission
    const subRes = await request(app)
      .post(`/api/v1/interviews/${interviewId}/questions/${question.id}/submissions`)
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({
        sourceCode: "print('solution')",
        language: "python",
        submissionType: "submit",
      });
    const submissionId = subRes.body.data.submission.id;

    // Simulate execution worker updating the submission with completed test results
    await Submission.findByIdAndUpdate(submissionId, {
      status: "completed",
      executionResult: {
        status: EXECUTION_STATUS.PASSED,
        passedCount: 2,
        failedCount: 0,
        totalCount: 2,
        durationMs: 45,
        peakMemoryKb: 12400,
        compileOutput: "",
        stdout: "all passed stdout",
        stderr: "",
        testResults: [
          {
            testIndex: 1,
            visibility: "public",
            status: EXECUTION_STATUS.PASSED,
            passed: true,
            input: "public_in",
            expectedOutput: "public_out",
            actualOutput: "public_out",
            durationMs: 20,
            memoryKb: 12000,
          },
          {
            testIndex: 2,
            visibility: "hidden",
            status: EXECUTION_STATUS.PASSED,
            passed: true,
            input: "super_secret_in",
            expectedOutput: "super_secret_out",
            actualOutput: "super_secret_out",
            durationMs: 25,
            memoryKb: 12400,
          },
        ],
      },
    });

    // 1. Candidate fetches submission
    const candGetRes = await request(app)
      .get(`/api/v1/submissions/${submissionId}`)
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(candGetRes.status).toBe(200);

    const candResult = candGetRes.body.data.submission.executionResult;
    expect(candResult.status).toBe(EXECUTION_STATUS.PASSED);
    expect(candResult.stderr).toBe(""); // Candidate stderr stripped

    // Public test: input and expectedOutput visible
    const candPublicTest = candResult.testResults.find((t) => t.visibility === "public");
    expect(candPublicTest.input).toBe("public_in");
    expect(candPublicTest.expectedOutput).toBe("public_out");
    expect(candPublicTest.actualOutput).toBe("public_out");

    // Hidden test: strictly masked! Neither input nor outputs are present
    const candHiddenTest = candResult.testResults.find((t) => t.visibility === "hidden");
    expect(candHiddenTest.input).toBeUndefined();
    expect(candHiddenTest.expectedOutput).toBeUndefined();
    expect(candHiddenTest.actualOutput).toBeUndefined();
    expect(candHiddenTest.passed).toBe(true);
    expect(candHiddenTest.status).toBe(EXECUTION_STATUS.PASSED);

    // 2. Candidate polls status endpoint GET /api/v1/submissions/:id/status
    const candStatusRes = await request(app)
      .get(`/api/v1/submissions/${submissionId}/status`)
      .set("Authorization", `Bearer ${candidateToken}`);
    expect(candStatusRes.status).toBe(200);
    expect(candStatusRes.body.data.status).toBe("completed");
    expect(candStatusRes.body.data.submissionType).toBe("submit");
    const maskedHiddenInStatus = candStatusRes.body.data.executionResult.testResults.find(
      (t) => t.visibility === "hidden",
    );
    expect(maskedHiddenInStatus.input).toBeUndefined();
    expect(maskedHiddenInStatus.expectedOutput).toBeUndefined();
    expect(maskedHiddenInStatus.actualOutput).toBeUndefined();

    // 3. Interviewer fetches submission: full test details visible
    const interviewerGetRes = await request(app)
      .get(`/api/v1/submissions/${submissionId}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(interviewerGetRes.status).toBe(200);

    const intResult = interviewerGetRes.body.data.submission.executionResult;
    expect(intResult.stdout).toBe("all passed stdout");
    const intHiddenTest = intResult.testResults.find((t) => t.visibility === "hidden");
    expect(intHiddenTest.input).toBe("super_secret_in");
    expect(intHiddenTest.expectedOutput).toBe("super_secret_out");
    expect(intHiddenTest.actualOutput).toBe("super_secret_out");
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import * as Y from "yjs";
import app from "../app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "../test/db.js";
import { initRealtimeGateway } from "../modules/realtime/realtime.gateway.js";
import { presenceService } from "../modules/realtime/presence.service.js";
import { collaborationService } from "../modules/collaboration/collaboration.service.js";
import { CodeDocument } from "../modules/collaboration/code-document.model.js";
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

async function createTestOrg(ownerToken, name = "Collaboration Test Org") {
  const res = await request(app)
    .post("/api/v1/organizations")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name });
  return res.body.data.organization;
}

async function createQuestion(token, orgId, title) {
  const res = await request(app)
    .post(`/api/v1/organizations/${orgId}/questions`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title,
      difficulty: "medium",
      statement: `Statement for ${title}`,
      starterCodeByLanguage: {
        javascript: "// Initial code\nfunction start() {}",
      },
    });
  return res.body.data.question;
}

describe("Real-time Collaboration & Socket.IO Gateway", () => {
  let server;
  let ioServer;
  let serverPort;

  beforeAll(async () => {
    await connectTestDb();

    server = http.createServer(app);
    ioServer = initRealtimeGateway(server);
    app.set("io", ioServer);

    await new Promise((resolve) => {
      server.listen(0, () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (ioServer) ioServer.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    presenceService.clear();
    collaborationService.activeDocs.clear();
  });

  function createSocket(token) {
    return ioClient(`http://localhost:${serverPort}`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });
  }

  it("authenticates valid connection and rejects invalid token", async () => {
    const user = await createTestUser({ name: "Auth User", email: "socketauth@test.com" });

    // 1. Valid user token connects
    const validSocket = createSocket(user.token);
    await new Promise((resolve, reject) => {
      validSocket.on("connect", () => {
        validSocket.disconnect();
        resolve();
      });
      validSocket.on("connect_error", (err) => {
        validSocket.disconnect();
        reject(err);
      });
    });

    // 2. Invalid token rejected
    const invalidSocket = createSocket("invalid-bogus-token");
    const errorReceived = await new Promise((resolve) => {
      invalidSocket.on("connect", () => {
        invalidSocket.disconnect();
        resolve(false);
      });
      invalidSocket.on("connect_error", (err) => {
        invalidSocket.disconnect();
        resolve(err.message);
      });
    });
    expect(errorReceived).toContain("Authentication failed");
  });

  it("handles interview:join, presence tracking, and duplicate connection without duplicate presence entries", async () => {
    const owner = await createTestUser({ name: "Lead Dev", email: "presence@test.com" });
    const org = await createTestOrg(owner.token);
    const question = await createQuestion(owner.token, org.id, "Presence Question");

    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Presence Interview",
        candidate: { name: "Presence Candidate", email: "cand@test.com" },
        interviewerIds: [owner.user.id],
        questions: [{ questionId: question.id, questionVersion: 1 }],
      });
    const interviewId = interviewRes.body.data.interview.id;

    const candidateToken = signCandidateRoomToken({
      interviewId,
      candidateEmail: "cand@test.com",
      candidateName: "Presence Candidate",
    });

    // 1. Interviewer joins room
    const interviewerSocket = createSocket(owner.token);
    await new Promise((resolve) => interviewerSocket.on("connect", resolve));

    const interviewerJoinedState = await new Promise((resolve) => {
      interviewerSocket.emit("interview:join", { interviewId }, (res) => {
        resolve(res);
      });
    });
    expect(interviewerJoinedState.success).toBe(true);
    expect(interviewerJoinedState.data.participants.length).toBe(1);

    // 2. Candidate connects and joins
    const candidateSocket1 = createSocket(candidateToken);
    await new Promise((resolve) => candidateSocket1.on("connect", resolve));

    const candidateJoinedState = await new Promise((resolve) => {
      candidateSocket1.emit("interview:join", { interviewId }, (res) => {
        resolve(res);
      });
    });
    expect(candidateJoinedState.success).toBe(true);
    expect(candidateJoinedState.data.participants.length).toBe(2);

    // 3. Candidate opens second tab (reconnection/duplicate socket from same user)
    const candidateSocket2 = createSocket(candidateToken);
    await new Promise((resolve) => candidateSocket2.on("connect", resolve));

    const tab2JoinedState = await new Promise((resolve) => {
      candidateSocket2.emit("interview:join", { interviewId }, (res) => {
        resolve(res);
      });
    });
    expect(tab2JoinedState.success).toBe(true);
    // Presence list must NOT have duplicate candidate records!
    expect(tab2JoinedState.data.participants.length).toBe(2);

    // Disconnect tab 1: Candidate should still remain in presence because tab 2 is open!
    candidateSocket1.disconnect();
    const activeParticipants = presenceService.getParticipants(interviewId);
    expect(activeParticipants.length).toBe(2);

    // Disconnect tab 2: Now candidate is removed
    candidateSocket2.disconnect();
    interviewerSocket.disconnect();
  });

  it("synchronizes Yjs edits between participants and persists state to MongoDB", async () => {
    const owner = await createTestUser({ name: "Editor Host", email: "editor@test.com" });
    const org = await createTestOrg(owner.token);
    const question = await createQuestion(owner.token, org.id, "Editor Question");

    const interviewRes = await request(app)
      .post(`/api/v1/organizations/${org.id}/interviews`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        title: "Editor Interview",
        candidate: { name: "Helen Candidate", email: "helen@test.com" },
        interviewerIds: [owner.user.id],
        questions: [{ questionId: question.id, questionVersion: 1 }],
      });
    const interviewId = interviewRes.body.data.interview.id;

    const candidateToken = signCandidateRoomToken({
      interviewId,
      candidateEmail: "helen@test.com",
      candidateName: "Helen Candidate",
    });

    const client1 = createSocket(owner.token);
    const client2 = createSocket(candidateToken);

    await Promise.all([
      new Promise((resolve) => client1.on("connect", resolve)),
      new Promise((resolve) => client2.on("connect", resolve)),
    ]);

    // Client 1 local Y.Doc
    const doc1 = new Y.Doc();
    const yText1 = doc1.getText("monaco");

    // Client 2 local Y.Doc
    const doc2 = new Y.Doc();
    const yText2 = doc2.getText("monaco");

    // Join document
    const client1SyncPromise = new Promise((resolve) => {
      client1.on("yjs:sync", ({ update }) => {
        Y.applyUpdate(doc1, new Uint8Array(Buffer.from(update, "base64")));
        resolve();
      });
    });
    client1.emit("yjs:join", { interviewId, questionId: question.id });
    await client1SyncPromise;

    const client2SyncPromise = new Promise((resolve) => {
      client2.on("yjs:sync", ({ update }) => {
        Y.applyUpdate(doc2, new Uint8Array(Buffer.from(update, "base64")));
        resolve();
      });
    });
    client2.emit("yjs:join", { interviewId, questionId: question.id });
    await client2SyncPromise;

    // Both clients receive initial starter code
    expect(yText1.toString()).toContain("function start()");
    expect(yText2.toString()).toContain("function start()");

    // Client 1 types code: "const x = 42;\n"
    const updateReceivedByClient2 = new Promise((resolve) => {
      client2.on("yjs:update", ({ update }) => {
        Y.applyUpdate(doc2, new Uint8Array(Buffer.from(update, "base64")));
        resolve();
      });
    });

    doc1.on("update", (update) => {
      client1.emit("yjs:update", {
        interviewId,
        questionId: question.id,
        update: Buffer.from(update).toString("base64"),
      });
    });

    yText1.insert(0, "const x = 42;\n");
    await updateReceivedByClient2;

    // Verify convergence: client 2 document now matches client 1!
    expect(yText2.toString()).toBe(yText1.toString());
    expect(yText2.toString()).toContain("const x = 42;");

    // Flush and test MongoDB persistence
    await collaborationService.flushDocument(interviewId, question.id);

    const dbRecord = await CodeDocument.findOne({
      interviewId,
      questionId: question.id,
    });
    expect(dbRecord).toBeDefined();
    expect(dbRecord.text).toContain("const x = 42;");
    expect(dbRecord.yjsState).toBeDefined();

    // Reconnection / reload recovery test
    const recoveredDoc = new Y.Doc();
    Y.applyUpdate(recoveredDoc, new Uint8Array(dbRecord.yjsState));
    expect(recoveredDoc.getText("monaco").toString()).toBe(yText1.toString());

    client1.disconnect();
    client2.disconnect();
  });
});

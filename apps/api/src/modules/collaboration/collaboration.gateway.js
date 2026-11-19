import * as Y from "yjs";
import { collaborationService } from "./collaboration.service.js";

/**
 * Attach collaborative document editing Socket.IO event handlers.
 *
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 * @param {object} participant
 */
export function setupCollaborationSocketHandlers(io, socket, participant) {
  // Join specific document namespace for an interview question
  socket.on("yjs:join", async (payload = {}, callback) => {
    try {
      const { interviewId, questionId, starterCode } = payload;
      if (!interviewId || !questionId) {
        if (typeof callback === "function") callback({ success: false, error: "Missing parameters" });
        return;
      }

      // Check candidate token boundary
      if (participant.isCandidate && String(participant.interviewId) !== String(interviewId)) {
        if (typeof callback === "function") callback({ success: false, error: "Unauthorized" });
        return;
      }

      const docRoom = `doc:${interviewId}:${questionId}`;

      // Leave previous document room if different
      if (socket.data.activeDocRoom && socket.data.activeDocRoom !== docRoom) {
        socket.leave(socket.data.activeDocRoom);
      }
      socket.join(docRoom);
      socket.data.activeDocRoom = docRoom;

      // Get or initialize server Y.Doc
      const serverDoc = await collaborationService.getOrCreateDocument(
        interviewId,
        questionId,
        starterCode,
      );

      // Send initial state update to client
      const initialUpdate = Buffer.from(Y.encodeStateAsUpdate(serverDoc)).toString(
        "base64",
      );

      socket.emit("yjs:sync", {
        interviewId: String(interviewId),
        questionId: String(questionId),
        update: initialUpdate,
      });

      if (typeof callback === "function") {
        callback({ success: true, text: serverDoc.getText("monaco").toString() });
      }
    } catch (err) {
      if (typeof callback === "function") callback({ success: false, error: err.message });
    }
  });

  // Client sent document edit delta
  socket.on("yjs:update", async (payload = {}) => {
    try {
      const { interviewId, questionId, update } = payload;
      if (!interviewId || !questionId || !update) return;

      // Authorization check
      if (participant.isCandidate && String(participant.interviewId) !== String(interviewId)) {
        return;
      }

      const docRoom = `doc:${interviewId}:${questionId}`;
      const serverDoc = await collaborationService.getOrCreateDocument(
        interviewId,
        questionId,
      );

      const updateBytes =
        typeof update === "string"
          ? new Uint8Array(Buffer.from(update, "base64"))
          : new Uint8Array(update);

      // Apply delta to authoritative server document
      Y.applyUpdate(serverDoc, updateBytes);

      // Broadcast update to all other participants in this document room
      socket.to(docRoom).emit("yjs:update", {
        interviewId: String(interviewId),
        questionId: String(questionId),
        update,
        senderId: participant.id,
      });
    } catch {
      // Ignore malformed update packets
    }
  });

  // Cursor and selection awareness
  socket.on("yjs:awareness", (payload = {}) => {
    const { interviewId, questionId, awareness } = payload;
    if (!interviewId || !questionId) return;

    const docRoom = `doc:${interviewId}:${questionId}`;
    socket.to(docRoom).emit("yjs:awareness", {
      interviewId: String(interviewId),
      questionId: String(questionId),
      awareness,
      participant,
    });
  });

  // Interviewer resets document to starter code
  socket.on("yjs:reset", async (payload = {}, callback) => {
    try {
      const { interviewId, questionId, starterCode } = payload;
      if (!interviewId || !questionId) {
        if (typeof callback === "function") callback({ success: false, error: "Missing parameters" });
        return;
      }

      if (participant.isCandidate) {
        if (typeof callback === "function") {
          callback({ success: false, error: "Candidates cannot reset document" });
        }
        return;
      }

      const docRoom = `doc:${interviewId}:${questionId}`;
      const doc = await collaborationService.resetDocument(
        interviewId,
        questionId,
        starterCode || "",
      );

      const resetUpdate = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");

      // Broadcast reset sync to everyone in document room including sender
      io.to(docRoom).emit("yjs:sync", {
        interviewId: String(interviewId),
        questionId: String(questionId),
        update: resetUpdate,
        isReset: true,
      });

      if (typeof callback === "function") callback({ success: true });
    } catch (err) {
      if (typeof callback === "function") callback({ success: false, error: err.message });
    }
  });
}

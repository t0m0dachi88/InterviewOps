import { Server } from "socket.io";
import { env } from "../../config/env.js";
import { User } from "../auth/user.model.js";
import { Session } from "../auth/session.model.js";
import {
  verifyAccessToken,
  verifyCandidateRoomToken,
} from "../auth/token.service.js";
import { Interview } from "../interviews/interview.model.js";
import { OrganizationMembership } from "../organizations/membership.model.js";
import { presenceService } from "./presence.service.js";
import { ORG_ROLES, USER_STATUS } from "@platform/shared";
import { setupCollaborationSocketHandlers } from "../collaboration/collaboration.gateway.js";

/**
 * Initialize the Socket.IO real-time gateway attached to the HTTP server.
 *
 * @param {import("http").Server} httpServer
 * @returns {Server}
 */
export function initRealtimeGateway(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
      methods: ["GET", "POST"],
    },
    pingTimeout: 20000,
    pingInterval: 10000,
  });

  // Socket.IO Handshake Authentication Middleware
  io.use(async (socket, next) => {
    try {
      const headerAuth = socket.handshake.headers.authorization || "";
      let token = socket.handshake.auth?.token || "";
      if (!token && headerAuth.toLowerCase().startsWith("bearer ")) {
        token = headerAuth.slice(7).trim();
      }

      if (!token) {
        return next(new Error("Authentication token required for WebSocket connection"));
      }

      // 1. Try candidate room token
      try {
        const candidatePayload = verifyCandidateRoomToken(token);
        socket.data.participant = {
          id: candidatePayload.candidateUserId || `candidate_${candidatePayload.candidateEmail}`,
          name: candidatePayload.candidateName,
          email: candidatePayload.candidateEmail,
          role: "candidate",
          isCandidate: true,
          interviewId: candidatePayload.interviewId,
        };
        return next();
      } catch {
        // Not candidate token, continue
      }

      // 2. Try user access token
      const userPayload = verifyAccessToken(token);
      const userId = userPayload.sub;
      const sessionId = userPayload.sid;

      const [user, session] = await Promise.all([
        User.findById(userId).lean(),
        Session.findById(sessionId).lean(),
      ]);

      if (!user || user.status !== USER_STATUS.ACTIVE) {
        return next(new Error("Active user account required"));
      }

      if (
        !session ||
        String(session.userId) !== String(user._id) ||
        session.revokedAt ||
        new Date(session.expiresAt).getTime() <= Date.now()
      ) {
        return next(new Error("Valid session required"));
      }

      socket.data.participant = {
        id: String(user._id),
        name: user.displayName || user.name || "Interviewer",
        email: user.email,
        role: "interviewer",
        isCandidate: false,
      };

      return next();
    } catch (err) {
      return next(new Error(`Authentication failed: ${err.message}`));
    }
  });

  io.on("connection", (socket) => {
    const participant = socket.data.participant;

    // Participant joins an interview room
    socket.on("interview:join", async (payload = {}, callback) => {
      try {
        const { interviewId } = payload;
        if (!interviewId) {
          if (typeof callback === "function") {
            callback({ success: false, error: "interviewId required" });
          }
          return;
        }

        const interview = await Interview.findById(interviewId).lean();
        if (!interview) {
          socket.emit("interview:error", { message: "Interview not found" });
          if (typeof callback === "function") callback({ success: false, error: "Interview not found" });
          return;
        }

        if (interview.status === "cancelled") {
          socket.emit("interview:error", { message: "Interview has been cancelled" });
          if (typeof callback === "function") callback({ success: false, error: "Interview cancelled" });
          return;
        }

        // Authorize participant for this specific interview
        if (participant.isCandidate) {
          if (String(participant.interviewId) !== String(interview._id)) {
            socket.emit("interview:error", { message: "Unauthorized for this interview room" });
            if (typeof callback === "function") callback({ success: false, error: "Unauthorized" });
            return;
          }
        } else {
          // Team member check
          const membership = await OrganizationMembership.findOne({
            organizationId: interview.organizationId,
            userId: participant.id,
            status: "active",
          }).lean();

          if (!membership) {
            socket.emit("interview:error", { message: "Not a member of hosting organization" });
            if (typeof callback === "function") callback({ success: false, error: "Forbidden" });
            return;
          }

          const isOwnerOrAdmin =
            membership.role === ORG_ROLES.OWNER || membership.role === ORG_ROLES.ADMIN;
          const isAssigned = (interview.interviewerIds || []).some(
            (id) => String(id) === String(participant.id),
          );

          if (!isOwnerOrAdmin && !isAssigned) {
            socket.emit("interview:error", { message: "Not assigned to this interview" });
            if (typeof callback === "function") callback({ success: false, error: "Forbidden" });
            return;
          }

          participant.role = membership.role;
        }

        const roomChannel = `interview:${interviewId}`;
        socket.join(roomChannel);
        socket.data.joinedInterviewId = String(interviewId);

        const presenceResult = presenceService.addParticipant(
          interviewId,
          socket.id,
          participant,
        );

        // Notify other room members if this is a newly joined participant
        if (presenceResult.isNewParticipant) {
          socket.to(roomChannel).emit("interview:participant_joined", {
            interviewId: String(interviewId),
            participant: presenceResult.participant,
            participants: presenceResult.participants,
            timestamp: new Date().toISOString(),
          });
        }

        const roomState = {
          interviewId: String(interviewId),
          activeQuestionId: interview.activeQuestionId
            ? String(interview.activeQuestionId)
            : interview.questionSnapshots?.[0]?.questionId
              ? String(interview.questionSnapshots[0].questionId)
              : null,
          participants: presenceResult.participants,
        };

        socket.emit("interview:room_state", roomState);

        if (typeof callback === "function") {
          callback({ success: true, data: roomState });
        }
      } catch (err) {
        socket.emit("interview:error", { message: err.message });
        if (typeof callback === "function") callback({ success: false, error: err.message });
      }
    });

    // Participant leaves an interview room
    socket.on("interview:leave", (payload = {}) => {
      const interviewId = payload.interviewId || socket.data.joinedInterviewId;
      if (!interviewId) return;

      const roomChannel = `interview:${interviewId}`;
      socket.leave(roomChannel);
      delete socket.data.joinedInterviewId;

      const removal = presenceService.removeSocket(socket.id);
      if (removal && removal.isRemoved) {
        io.to(roomChannel).emit("interview:participant_left", {
          interviewId: String(interviewId),
          participantId: removal.participantId,
          participant: removal.participant,
          participants: removal.participants,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Interviewer changes active question via Socket event
    socket.on("interview:set_active_question", async (payload = {}, callback) => {
      try {
        const { interviewId, questionId } = payload;
        if (!interviewId || !questionId) {
          if (typeof callback === "function") callback({ success: false, error: "Missing fields" });
          return;
        }

        if (participant.isCandidate) {
          if (typeof callback === "function") callback({ success: false, error: "Candidates cannot change question" });
          return;
        }

        const interview = await Interview.findById(interviewId);
        if (!interview) {
          if (typeof callback === "function") callback({ success: false, error: "Interview not found" });
          return;
        }

        const questionSnapshot = (interview.questionSnapshots || []).find(
          (q) => String(q.questionId) === String(questionId),
        );

        if (!questionSnapshot) {
          if (typeof callback === "function") callback({ success: false, error: "Question not in assessment" });
          return;
        }

        interview.activeQuestionId = questionSnapshot.questionId;
        await interview.save();

        io.to(`interview:${interviewId}`).emit("interview:active_question_changed", {
          interviewId: String(interviewId),
          questionId: String(questionSnapshot.questionId),
          questionTitle: questionSnapshot.title,
          switchedBy: participant,
          timestamp: new Date().toISOString(),
        });

        if (typeof callback === "function") callback({ success: true });
      } catch (err) {
        if (typeof callback === "function") callback({ success: false, error: err.message });
      }
    });

    // Setup collaborative editor socket handlers (Yjs sync & awareness)
    setupCollaborationSocketHandlers(io, socket, participant);

    // Socket disconnection
    socket.on("disconnect", () => {
      const removal = presenceService.removeSocket(socket.id);
      if (removal && removal.isRemoved) {
        io.to(`interview:${removal.interviewId}`).emit("interview:participant_left", {
          interviewId: String(removal.interviewId),
          participantId: removal.participantId,
          participant: removal.participant,
          participants: removal.participants,
          timestamp: new Date().toISOString(),
        });
      }
    });
  });

  return io;
}

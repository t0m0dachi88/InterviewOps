import { asyncHandler } from "../../utils/async-handler.js";
import { sendSuccess } from "../../utils/response.js";
import {
  getInterviewRoom,
  getActiveQuestion,
  setActiveQuestion,
  authorizeInterviewAccess,
} from "./interview-room.service.js";
import { presenceService } from "../realtime/presence.service.js";

export const getRoom = asyncHandler(async (req, res) => {
  const { interviewId } = req.params;
  const roomData = await getInterviewRoom(interviewId, {
    participantType: req.participantType,
    user: req.user,
    candidate: req.candidate,
  });

  return sendSuccess(res, roomData);
});

export const joinRoom = asyncHandler(async (req, res) => {
  const { interviewId } = req.params;
  const { participant } = await authorizeInterviewAccess(interviewId, {
    participantType: req.participantType,
    user: req.user,
    candidate: req.candidate,
  });

  // REST presence check/ping
  const participants = presenceService.getParticipants(interviewId);
  return sendSuccess(res, {
    joined: true,
    participant,
    participants,
  });
});

export const leaveRoom = asyncHandler(async (req, res) => {
  const { interviewId } = req.params;
  const { participant } = await authorizeInterviewAccess(interviewId, {
    participantType: req.participantType,
    user: req.user,
    candidate: req.candidate,
  });

  presenceService.removeParticipant(interviewId, participant.id);
  const participants = presenceService.getParticipants(interviewId);

  return sendSuccess(res, {
    left: true,
    participantId: participant.id,
    participants,
  });
});

export const getActiveQuestionHandler = asyncHandler(async (req, res) => {
  const { interviewId } = req.params;
  const activeQuestionData = await getActiveQuestion(interviewId, {
    participantType: req.participantType,
    user: req.user,
    candidate: req.candidate,
  });

  return sendSuccess(res, activeQuestionData);
});

export const setActiveQuestionHandler = asyncHandler(async (req, res) => {
  const { interviewId } = req.params;
  const { questionId } = req.body;

  const result = await setActiveQuestion(interviewId, questionId, {
    participantType: req.participantType,
    user: req.user,
    candidate: req.candidate,
  });

  // If Socket.IO server is attached, broadcast active question change
  if (req.app.get("io")) {
    const io = req.app.get("io");
    io.to(`interview:${interviewId}`).emit("interview:active_question_changed", {
      interviewId,
      questionId: result.activeQuestionId,
      questionTitle: result.questionTitle,
      switchedBy: result.switchedBy,
      timestamp: new Date().toISOString(),
    });
  }

  return sendSuccess(res, result);
});


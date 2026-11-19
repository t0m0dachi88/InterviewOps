import { asyncHandler } from "../../utils/async-handler.js";
import { sendSuccess } from "../../utils/response.js";
import {
  createSubmission,
  listSubmissions,
  getSubmissionById,
  getSubmissionStatus,
} from "./submission.service.js";

export const createSubmissionHandler = asyncHandler(async (req, res) => {
  const { interviewId, questionId } = req.params;
  const io = req.app.get("io") || null;

  const result = await createSubmission({
    interviewId,
    questionId,
    payload: req.body,
    reqContext: {
      participantType: req.participantType,
      user: req.user,
      candidate: req.candidate,
    },
    io,
  });

  return sendSuccess(res, result, {}, result.isDuplicate ? 200 : 201);
});

export const listSubmissionsHandler = asyncHandler(async (req, res) => {
  const { interviewId, questionId } = req.params;

  const result = await listSubmissions({
    interviewId,
    questionId,
    reqContext: {
      participantType: req.participantType,
      user: req.user,
      candidate: req.candidate,
    },
  });

  return sendSuccess(res, result);
});

export const getSubmissionByIdHandler = asyncHandler(async (req, res) => {
  const { submissionId } = req.params;

  const result = await getSubmissionById(submissionId, {
    participantType: req.participantType,
    user: req.user,
    candidate: req.candidate,
  });

  return sendSuccess(res, result);
});

export const getSubmissionStatusHandler = asyncHandler(async (req, res) => {
  const { submissionId } = req.params;

  const result = await getSubmissionStatus(submissionId, {
    participantType: req.participantType,
    user: req.user,
    candidate: req.candidate,
  });

  return sendSuccess(res, result);
});


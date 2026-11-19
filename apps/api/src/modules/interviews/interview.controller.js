import { asyncHandler } from "../../utils/async-handler.js";
import { sendSuccess } from "../../utils/response.js";
import {
  createInterview,
  listInterviews,
  getInterview,
  updateInterview,
  cancelInterview,
  transitionInterviewStatus,
  assignInterviewers,
} from "./interview.service.js";

export const createInterviewHandler = asyncHandler(async (req, res) => {
  const { organizationId } = req.params;
  const interview = await createInterview(organizationId, req.body, req.user);
  return sendSuccess(res, { interview }, {}, 201);
});

export const listInterviewsHandler = asyncHandler(async (req, res) => {
  const { organizationId } = req.params;
  const result = await listInterviews(organizationId, req.query);
  return sendSuccess(res, result);
});

export const getInterviewHandler = asyncHandler(async (req, res) => {
  const { organizationId, interviewId } = req.params;
  const interview = await getInterview(organizationId, interviewId);
  return sendSuccess(res, { interview });
});

export const updateInterviewHandler = asyncHandler(async (req, res) => {
  const { organizationId, interviewId } = req.params;
  const interview = await updateInterview(organizationId, interviewId, req.body, req.user);
  return sendSuccess(res, { interview });
});

export const cancelInterviewHandler = asyncHandler(async (req, res) => {
  const { organizationId, interviewId } = req.params;
  const interview = await cancelInterview(organizationId, interviewId, req.body.reason, req.user);
  return sendSuccess(res, { interview });
});

export const transitionStatusHandler = asyncHandler(async (req, res) => {
  const { organizationId, interviewId } = req.params;
  const interview = await transitionInterviewStatus(
    organizationId,
    interviewId,
    req.body.status,
    req.user,
  );
  return sendSuccess(res, { interview });
});

export const assignInterviewersHandler = asyncHandler(async (req, res) => {
  const { organizationId, interviewId } = req.params;
  const interview = await assignInterviewers(
    organizationId,
    interviewId,
    req.body.interviewerIds,
    req.user,
  );
  return sendSuccess(res, { interview });
});


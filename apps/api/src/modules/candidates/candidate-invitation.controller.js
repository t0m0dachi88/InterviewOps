import { asyncHandler } from "../../utils/async-handler.js";
import { sendSuccess } from "../../utils/response.js";
import {
  createCandidateInvitation,
  getCandidateInvitationByToken,
  acceptCandidateInvitation,
} from "./candidate-invitation.service.js";
import { Interview } from "../interviews/interview.model.js";
import { OrganizationMembership } from "../organizations/membership.model.js";
import { AppError } from "../../middleware/error.middleware.js";
import { ERROR_CODES } from "@platform/shared";

export const inviteCandidateHandler = asyncHandler(async (req, res) => {
  const { interviewId } = req.params;
  const { candidateName, candidateEmail, externalRef } = req.body;

  if (!candidateName || !candidateEmail) {
    throw new AppError(
      "Candidate name and email are required",
      400,
      ERROR_CODES.VALIDATION_ERROR,
    );
  }

  const interview = await Interview.findById(interviewId);
  if (!interview) {
    throw new AppError("Interview not found", 404, ERROR_CODES.INTERVIEW_NOT_FOUND);
  }

  // Ensure current user is an active member of the hosting org
  const membership = await OrganizationMembership.findOne({
    organizationId: interview.organizationId,
    userId: req.user.id,
    status: "active",
  });

  if (!membership) {
    throw new AppError(
      "You do not have permission to invite candidates for this organization",
      403,
      ERROR_CODES.FORBIDDEN,
    );
  }

  const result = await createCandidateInvitation({
    organizationId: interview.organizationId,
    interviewId: interview._id,
    candidateName,
    candidateEmail,
    externalRef,
    actorUserId: req.user.id,
  });

  return sendSuccess(res, result, {}, 201);
});

export const getInvitationByTokenHandler = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const result = await getCandidateInvitationByToken(token);
  return sendSuccess(res, result);
});

export const acceptInvitationHandler = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const result = await acceptCandidateInvitation({ token });
  return sendSuccess(res, result);
});

export const exchangeJoinTokenHandler = asyncHandler(async (req, res) => {
  const { interviewId } = req.params;
  const { token } = req.body;

  if (!token) {
    throw new AppError("Token is required", 400, ERROR_CODES.VALIDATION_ERROR);
  }

  const result = await acceptCandidateInvitation({ token });
  if (String(result.interviewId) !== String(interviewId)) {
    throw new AppError(
      "Token does not match the requested interview",
      403,
      ERROR_CODES.FORBIDDEN,
    );
  }

  return sendSuccess(res, result);
});


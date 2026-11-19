import mongoose from "mongoose";
import {
  CANDIDATE_INVITATION_STATUS,
  ERROR_CODES,
  INTERVIEW_STATUS,
} from "@platform/shared";
import { AppError } from "../../middleware/error.middleware.js";
import { CandidateInvitation } from "./candidate-invitation.model.js";
import { Interview } from "../interviews/interview.model.js";
import { Organization } from "../organizations/organization.model.js";
import {
  generateCandidateToken,
  hashCandidateToken,
  signCandidateRoomToken,
} from "../auth/token.service.js";

function notFound(message = "Candidate invitation not found") {
  return new AppError(
    message,
    404,
    ERROR_CODES.CANDIDATE_INVITATION_NOT_FOUND,
  );
}

/**
 * Issue a candidate invitation for a scheduled interview.
 */
export async function createCandidateInvitation({
  organizationId,
  interviewId,
  candidateName,
  candidateEmail,
  externalRef = "",
  actorUserId,
}) {
  if (!mongoose.isValidObjectId(interviewId)) {
    throw new AppError("Invalid interview ID", 400, ERROR_CODES.VALIDATION_ERROR);
  }

  const interview = await Interview.findOne({
    _id: interviewId,
    organizationId,
  });

  if (!interview) {
    throw new AppError("Interview not found", 404, ERROR_CODES.INTERVIEW_NOT_FOUND);
  }

  if (
    interview.status === INTERVIEW_STATUS.COMPLETED ||
    interview.status === INTERVIEW_STATUS.CANCELLED
  ) {
    throw new AppError(
      `Cannot invite candidate to an interview in '${interview.status}' status`,
      400,
      ERROR_CODES.INVALID_STATUS_TRANSITION,
    );
  }

  const normalizedEmail = candidateEmail.trim().toLowerCase();
  const normalizedName = candidateName.trim();

  // Revoke previous pending invitations for this interview
  await CandidateInvitation.updateMany(
    {
      interviewId: interview._id,
      status: CANDIDATE_INVITATION_STATUS.PENDING,
    },
    {
      $set: {
        status: CANDIDATE_INVITATION_STATUS.REVOKED,
        revokedAt: new Date(),
      },
    },
  );

  const rawToken = generateCandidateToken();
  const tokenHash = hashCandidateToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invitation = new CandidateInvitation({
    organizationId,
    interviewId: interview._id,
    candidateName: normalizedName,
    candidateEmail: normalizedEmail,
    externalRef: externalRef ? externalRef.trim() : "",
    tokenHash,
    expiresAt,
    status: CANDIDATE_INVITATION_STATUS.PENDING,
    invitedBy: actorUserId,
  });

  await invitation.save();

  // Update interview candidate profile
  interview.candidate = {
    name: normalizedName,
    email: normalizedEmail,
    externalRef: externalRef ? externalRef.trim() : "",
  };

  if (interview.status === INTERVIEW_STATUS.DRAFT && interview.scheduledStartAt) {
    interview.status = INTERVIEW_STATUS.SCHEDULED;
  }
  await interview.save();

  return {
    invitation: {
      id: String(invitation._id),
      interviewId: String(invitation.interviewId),
      candidateName: invitation.candidateName,
      candidateEmail: invitation.candidateEmail,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    },
    rawToken,
  };
}

/**
 * Retrieve public candidate invitation details by token.
 */
export async function getCandidateInvitationByToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string") {
    throw notFound();
  }

  const tokenHash = hashCandidateToken(rawToken.trim());
  const invitation = await CandidateInvitation.findOne({ tokenHash });

  if (!invitation) {
    throw notFound();
  }

  if (
    invitation.status === CANDIDATE_INVITATION_STATUS.PENDING &&
    invitation.expiresAt.getTime() <= Date.now()
  ) {
    invitation.status = CANDIDATE_INVITATION_STATUS.EXPIRED;
    await invitation.save();
  }

  const [interview, organization] = await Promise.all([
    Interview.findById(invitation.interviewId).lean(),
    Organization.findById(invitation.organizationId).lean(),
  ]);

  if (!interview) {
    throw new AppError("Interview not found", 404, ERROR_CODES.INTERVIEW_NOT_FOUND);
  }

  return {
    invitation: {
      id: String(invitation._id),
      candidateName: invitation.candidateName,
      candidateEmail: invitation.candidateEmail,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      acceptedAt: invitation.acceptedAt ? invitation.acceptedAt.toISOString() : null,
    },
    interview: {
      id: String(interview._id),
      title: interview.title,
      description: interview.description || "",
      interviewType: interview.interviewType,
      durationMinutes: interview.durationMinutes,
      scheduledStartAt: interview.scheduledStartAt ? interview.scheduledStartAt.toISOString() : null,
      scheduledEndAt: interview.scheduledEndAt ? interview.scheduledEndAt.toISOString() : null,
      timezone: interview.timezone || "UTC",
      status: interview.status,
    },
    organization: {
      id: String(organization?._id || ""),
      name: organization?.name || "Hiring Team",
    },
  };
}

/**
 * Accept candidate invitation and issue scoped room token.
 */
export async function acceptCandidateInvitation({ token }) {
  if (!token || typeof token !== "string") {
    throw notFound();
  }

  const tokenHash = hashCandidateToken(token.trim());
  const invitation = await CandidateInvitation.findOne({ tokenHash });

  if (!invitation) {
    throw notFound();
  }

  if (invitation.status === CANDIDATE_INVITATION_STATUS.REVOKED) {
    throw new AppError(
      "This invitation has been revoked",
      400,
      ERROR_CODES.CANDIDATE_INVITATION_REVOKED,
    );
  }

  if (
    invitation.status === CANDIDATE_INVITATION_STATUS.EXPIRED ||
    invitation.expiresAt.getTime() <= Date.now()
  ) {
    if (invitation.status !== CANDIDATE_INVITATION_STATUS.EXPIRED) {
      invitation.status = CANDIDATE_INVITATION_STATUS.EXPIRED;
      await invitation.save();
    }
    throw new AppError(
      "This invitation has expired",
      400,
      ERROR_CODES.CANDIDATE_INVITATION_EXPIRED,
    );
  }

  if (invitation.status === CANDIDATE_INVITATION_STATUS.PENDING) {
    invitation.status = CANDIDATE_INVITATION_STATUS.ACCEPTED;
    invitation.acceptedAt = new Date();
    await invitation.save();
  }

  const interview = await Interview.findById(invitation.interviewId);
  if (!interview) {
    throw new AppError("Interview not found", 404, ERROR_CODES.INTERVIEW_NOT_FOUND);
  }

  if (interview.status === INTERVIEW_STATUS.CANCELLED) {
    throw new AppError(
      "This interview has been cancelled",
      400,
      ERROR_CODES.INVALID_STATUS_TRANSITION,
    );
  }

  const roomToken = signCandidateRoomToken({
    interviewId: interview._id,
    candidateEmail: invitation.candidateEmail,
    candidateName: invitation.candidateName,
  });

  return {
    roomToken,
    interviewId: String(interview._id),
    candidateName: invitation.candidateName,
    candidateEmail: invitation.candidateEmail,
  };
}

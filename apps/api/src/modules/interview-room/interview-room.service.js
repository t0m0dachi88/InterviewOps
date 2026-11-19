import mongoose from "mongoose";
import {
  ERROR_CODES,
  INTERVIEW_STATUS,
  ORG_ROLES,
} from "@platform/shared";
import { AppError } from "../../middleware/error.middleware.js";
import { Interview } from "../interviews/interview.model.js";
import { OrganizationMembership } from "../organizations/membership.model.js";
import { Organization } from "../organizations/organization.model.js";
import { presenceService } from "../realtime/presence.service.js";

function notFound(message = "Interview not found") {
  return new AppError(message, 404, ERROR_CODES.INTERVIEW_NOT_FOUND);
}

function forbidden(message = "You are not authorized to access this interview room") {
  return new AppError(message, 403, ERROR_CODES.FORBIDDEN);
}

/**
 * Validate that a participant has authorization to enter the interview room.
 *
 * @param {string} interviewId
 * @param {object} reqContext - Contains { participantType, user, candidate }
 * @returns {Promise<{ interview: any, participant: { id: string, name: string, role: string, isCandidate: boolean } }>}
 */
export async function authorizeInterviewAccess(interviewId, reqContext) {
  if (!mongoose.isValidObjectId(interviewId)) {
    throw notFound();
  }

  const interview = await Interview.findById(interviewId);
  if (!interview) {
    throw notFound();
  }

  if (interview.status === INTERVIEW_STATUS.CANCELLED) {
    throw new AppError(
      "This interview has been cancelled and cannot be accessed",
      400,
      ERROR_CODES.INVALID_STATUS_TRANSITION,
    );
  }

  const { participantType, user, candidate } = reqContext;

  // Case 1: Candidate Access
  if (participantType === "candidate" && candidate) {
    if (String(candidate.interviewId) !== String(interview._id)) {
      throw forbidden("Candidate token is not authorized for this interview room");
    }

    return {
      interview,
      participant: {
        id: candidate.userId || `candidate_${candidate.email}`,
        name: candidate.name || interview.candidate?.name || "Candidate",
        role: "candidate",
        isCandidate: true,
      },
    };
  }

  // Case 2: Organization Team Member (interviewer, admin, owner)
  if (participantType === "team_member" && user) {
    const membership = await OrganizationMembership.findOne({
      organizationId: interview.organizationId,
      userId: user.id,
      status: "active",
    });

    if (!membership) {
      throw forbidden("You are not a member of the organization hosting this interview");
    }

    const isOwnerOrAdmin =
      membership.role === ORG_ROLES.OWNER || membership.role === ORG_ROLES.ADMIN;
    const isAssignedInterviewer = (interview.interviewerIds || []).some(
      (id) => String(id) === String(user.id),
    );

    if (!isOwnerOrAdmin && !isAssignedInterviewer) {
      throw forbidden("You are not an assigned interviewer for this interview");
    }

    return {
      interview,
      participant: {
        id: String(user.id),
        name: user.displayName || user.name || "Interviewer",
        role: membership.role,
        isCandidate: false,
      },
    };
  }

  throw new AppError("Authentication required", 401, ERROR_CODES.UNAUTHORIZED);
}

/**
 * Retrieve interview room state, questions, presence, and permissions.
 */
export async function getInterviewRoom(interviewId, reqContext) {
  const { interview, participant } = await authorizeInterviewAccess(
    interviewId,
    reqContext,
  );

  // Auto-transition to in_progress / live if an authorized team member joins a scheduled or waiting interview
  if (
    !participant.isCandidate &&
    (interview.status === INTERVIEW_STATUS.SCHEDULED ||
      interview.status === INTERVIEW_STATUS.WAITING)
  ) {
    interview.status = INTERVIEW_STATUS.IN_PROGRESS;
    if (!interview.startedAt) {
      interview.startedAt = new Date();
    }
    await interview.save();
  }

  const [organization] = await Promise.all([
    Organization.findById(interview.organizationId).lean(),
  ]);

  // Determine active question
  let activeQuestionId = interview.activeQuestionId
    ? String(interview.activeQuestionId)
    : null;

  if (
    !activeQuestionId &&
    interview.questionSnapshots &&
    interview.questionSnapshots.length > 0
  ) {
    activeQuestionId = String(interview.questionSnapshots[0].questionId);
    interview.activeQuestionId = interview.questionSnapshots[0].questionId;
    await interview.save();
  }

  // Format questions (sanitize hidden tests if participant is a candidate!)
  const isCandidate = participant.isCandidate;
  const questions = (interview.questionSnapshots || []).map((q) => {
    let starterCode = {};
    if (q.starterCodeByLanguage) {
      if (typeof q.starterCodeByLanguage.get === "function") {
        for (const [k, v] of q.starterCodeByLanguage.entries()) {
          starterCode[k] = v;
        }
      } else {
        starterCode = { ...q.starterCodeByLanguage };
      }
    }

    const item = {
      questionId: String(q.questionId),
      version: q.version,
      title: q.title,
      statement: q.statement,
      constraints: q.constraints || [],
      examples: (q.examples || []).map((ex) => ({
        input: ex.input,
        output: ex.output,
        explanation: ex.explanation || "",
      })),
      allowedLanguages: q.allowedLanguages || [],
      starterCodeByLanguage: starterCode,
      publicTests: (q.publicTests || []).map((t) => ({
        input: t.input,
        expectedOutput: t.expectedOutput,
      })),
      timeLimitMs: q.timeLimitMs,
      memoryLimitMb: q.memoryLimitMb,
      order: q.order || 1,
      timeAllocationMinutes: q.timeAllocationMinutes || 30,
    };

    if (!isCandidate && q.hiddenTests) {
      item.hiddenTests = q.hiddenTests.map((t) => ({
        input: t.input,
        expectedOutput: t.expectedOutput,
      }));
    }

    return item;
  });

  const participants = presenceService.getParticipants(interview._id);

  return {
    interview: {
      id: String(interview._id),
      title: interview.title,
      description: interview.description || "",
      interviewType: interview.interviewType,
      status: interview.status,
      durationMinutes: interview.durationMinutes,
      scheduledStartAt: interview.scheduledStartAt
        ? interview.scheduledStartAt.toISOString()
        : null,
      scheduledEndAt: interview.scheduledEndAt
        ? interview.scheduledEndAt.toISOString()
        : null,
      startedAt: interview.startedAt ? interview.startedAt.toISOString() : null,
      endedAt: interview.endedAt ? interview.endedAt.toISOString() : null,
      timezone: interview.timezone || "UTC",
      organizationId: String(interview.organizationId),
      organizationName: organization?.name || "Hiring Team",
      candidate: {
        name: interview.candidate?.name || "",
        email: interview.candidate?.email || "",
      },
    },
    participant,
    activeQuestionId,
    questions,
    participants,
    permissions: {
      canEdit: true,
      canNavigateQuestions: !participant.isCandidate,
      canEndInterview: !participant.isCandidate,
      isInterviewer: !participant.isCandidate,
    },
  };
}

/**
 * Set the currently active question for an interview.
 * Only authorized team members can change the active question.
 */
export async function setActiveQuestion(interviewId, questionId, reqContext) {
  const { interview, participant } = await authorizeInterviewAccess(
    interviewId,
    reqContext,
  );

  if (participant.isCandidate) {
    throw forbidden("Candidates cannot change the active assessment question");
  }

  if (!mongoose.isValidObjectId(questionId)) {
    throw new AppError("Invalid question ID", 400, ERROR_CODES.VALIDATION_ERROR);
  }

  const matchingSnapshot = (interview.questionSnapshots || []).find(
    (q) => String(q.questionId) === String(questionId),
  );

  if (!matchingSnapshot) {
    throw new AppError(
      "Question is not part of this interview's assessment",
      404,
      ERROR_CODES.QUESTION_NOT_FOUND,
    );
  }

  interview.activeQuestionId = matchingSnapshot.questionId;
  await interview.save();

  return {
    activeQuestionId: String(matchingSnapshot.questionId),
    questionTitle: matchingSnapshot.title,
    switchedBy: participant,
  };
}

/**
 * Get the currently active question snapshot.
 */
export async function getActiveQuestion(interviewId, reqContext) {
  const { interview, participant } = await authorizeInterviewAccess(
    interviewId,
    reqContext,
  );

  let activeId = interview.activeQuestionId
    ? String(interview.activeQuestionId)
    : null;

  if (
    !activeId &&
    interview.questionSnapshots &&
    interview.questionSnapshots.length > 0
  ) {
    activeId = String(interview.questionSnapshots[0].questionId);
  }

  const snapshot = (interview.questionSnapshots || []).find(
    (q) => String(q.questionId) === activeId,
  );

  if (!snapshot) {
    throw new AppError(
      "No active question set for this interview",
      404,
      ERROR_CODES.QUESTION_NOT_FOUND,
    );
  }

  let starterCode = {};
  if (snapshot.starterCodeByLanguage) {
    if (typeof snapshot.starterCodeByLanguage.get === "function") {
      for (const [k, v] of snapshot.starterCodeByLanguage.entries()) {
        starterCode[k] = v;
      }
    } else {
      starterCode = { ...snapshot.starterCodeByLanguage };
    }
  }

  const result = {
    questionId: String(snapshot.questionId),
    version: snapshot.version,
    title: snapshot.title,
    statement: snapshot.statement,
    constraints: snapshot.constraints || [],
    examples: (snapshot.examples || []).map((ex) => ({
      input: ex.input,
      output: ex.output,
      explanation: ex.explanation || "",
    })),
    allowedLanguages: snapshot.allowedLanguages || [],
    starterCodeByLanguage: starterCode,
    publicTests: (snapshot.publicTests || []).map((t) => ({
      input: t.input,
      expectedOutput: t.expectedOutput,
    })),
    timeLimitMs: snapshot.timeLimitMs,
    memoryLimitMb: snapshot.memoryLimitMb,
  };

  if (!participant.isCandidate && snapshot.hiddenTests) {
    result.hiddenTests = snapshot.hiddenTests.map((t) => ({
      input: t.input,
      expectedOutput: t.expectedOutput,
    }));
  }

  return {
    activeQuestionId: String(snapshot.questionId),
    question: result,
  };
}

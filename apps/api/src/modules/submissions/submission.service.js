import mongoose from "mongoose";
import {
  ERROR_CODES,
  SUPPORTED_LANGUAGES,
  SUBMISSION_LIFECYCLE,
  SUBMISSION_TYPE,
  EXECUTION_STATUS,
} from "@platform/shared";
import { AppError } from "../../middleware/error.middleware.js";
import { Submission, SUBMISSION_STATUS } from "./submission.model.js";
import { authorizeInterviewAccess } from "../interview-room/interview-room.service.js";
import { enqueueExecutionJob } from "../queue/execution-queue.service.js";

function notFound(message = "Submission not found") {
  return new AppError(message, 404, ERROR_CODES.NOT_FOUND);
}

function forbidden(message = "You are not authorized to access this submission") {
  return new AppError(message, 403, ERROR_CODES.FORBIDDEN);
}

/**
 * Role-based submission serializer ensuring complete hidden test case protection.
 *
 * @param {object} sub - Raw Mongoose document or lean object
 * @param {object} [options]
 * @param {boolean} [options.isCandidate=false] - Whether the caller is a candidate
 * @returns {object}
 */
export function serializeSubmission(sub, options = {}) {
  const isCandidate = Boolean(options.isCandidate);

  let executionResult = null;
  if (sub.executionResult) {
    const rawRes = sub.executionResult;
    executionResult = {
      status: rawRes.status,
      passedCount: rawRes.passedCount ?? 0,
      failedCount: rawRes.failedCount ?? 0,
      totalCount: rawRes.totalCount ?? 0,
      durationMs: rawRes.durationMs ?? 0,
      peakMemoryKb: rawRes.peakMemoryKb ?? 0,
      compileOutput: rawRes.compileOutput || "",
      stderr: isCandidate ? "" : (rawRes.stderr || ""),
      stdout: rawRes.stdout || "",
      errorMessage: rawRes.errorMessage || "",
      executedAt: rawRes.executedAt ? new Date(rawRes.executedAt).toISOString() : null,
      testResults: (rawRes.testResults || []).map((tr) => {
        const isHidden = tr.visibility === "hidden";
        if (isCandidate && isHidden) {
          // STRICT SECURITY: Never expose hidden test inputs or expected outputs to candidates!
          return {
            testIndex: tr.testIndex,
            visibility: "hidden",
            status: tr.status,
            passed: tr.passed,
            durationMs: tr.durationMs || 0,
          };
        }
        return {
          testIndex: tr.testIndex,
          visibility: tr.visibility || "public",
          status: tr.status,
          passed: tr.passed,
          input: tr.input || "",
          expectedOutput: tr.expectedOutput || "",
          actualOutput: tr.actualOutput || "",
          compileOutput: tr.compileOutput || "",
          stderr: tr.stderr || "",
          durationMs: tr.durationMs || 0,
          memoryKb: tr.memoryKb || 0,
        };
      }),
    };
  }

  return {
    id: String(sub._id),
    organizationId: String(sub.organizationId),
    interviewId: String(sub.interviewId),
    questionId: String(sub.questionId),
    questionVersion: sub.questionVersion,
    candidateUserId: sub.candidateUserId ? String(sub.candidateUserId) : null,
    candidateName: sub.candidateName,
    candidateEmail: sub.candidateEmail,
    language: sub.language,
    sourceCode: sub.sourceCode,
    documentVersion: sub.documentVersion,
    submissionType: sub.submissionType || SUBMISSION_TYPE.SUBMIT,
    status: sub.status,
    sequenceNumber: sub.sequenceNumber,
    submittedBy: sub.submittedBy,
    executionResult,
    createdAt: sub.createdAt ? new Date(sub.createdAt).toISOString() : null,
  };
}

/**
 * Create a new code submission (draft save or execution job).
 */
export async function createSubmission({
  interviewId,
  questionId,
  payload,
  reqContext,
  io = null,
  injectedQueue = null,
}) {
  const { interview, participant } = await authorizeInterviewAccess(
    interviewId,
    reqContext,
  );

  if (!mongoose.isValidObjectId(questionId)) {
    throw new AppError("Invalid question ID", 400, ERROR_CODES.VALIDATION_ERROR);
  }

  const questionSnapshot = (interview.questionSnapshots || []).find(
    (q) => String(q.questionId) === String(questionId),
  );

  if (!questionSnapshot) {
    throw new AppError(
      "Question is not attached to this interview",
      404,
      ERROR_CODES.QUESTION_NOT_FOUND,
    );
  }

  const {
    sourceCode,
    language = "javascript",
    documentVersion = 1,
    status = null,
    submissionType = null,
    idempotencyKey = null,
  } = payload;

  if (typeof sourceCode !== "string") {
    throw new AppError(
      "sourceCode is required and must be a string",
      400,
      ERROR_CODES.VALIDATION_ERROR,
    );
  }

  if (sourceCode.length > 131072) {
    throw new AppError(
      "Source code exceeds maximum permitted size (128 KB)",
      400,
      ERROR_CODES.VALIDATION_ERROR,
    );
  }

  if (!SUPPORTED_LANGUAGES.includes(language)) {
    throw new AppError(
      `Unsupported language '${language}'. Supported: ${SUPPORTED_LANGUAGES.join(", ")}`,
      400,
      ERROR_CODES.VALIDATION_ERROR,
    );
  }

  // Determine submission type and lifecycle status
  const isDraftSave = status === SUBMISSION_STATUS.SAVED;
  const effectiveSubmissionType =
    submissionType === SUBMISSION_TYPE.RUN
      ? SUBMISSION_TYPE.RUN
      : SUBMISSION_TYPE.SUBMIT;

  const effectiveStatus = isDraftSave
    ? SUBMISSION_STATUS.SAVED
    : SUBMISSION_LIFECYCLE.QUEUED;

  // Rate limiting: max 30 submissions per participant per minute in this interview
  const oneMinuteAgo = new Date(Date.now() - 60000);
  const recentCount = await Submission.countDocuments({
    interviewId: interview._id,
    "submittedBy.id": participant.id,
    createdAt: { $gte: oneMinuteAgo },
  });

  if (recentCount >= 30) {
    throw new AppError(
      "Submission rate limit exceeded. Please wait before submitting again.",
      429,
      ERROR_CODES.RATE_LIMIT_EXCEEDED,
    );
  }

  // Idempotency check
  if (idempotencyKey) {
    const existing = await Submission.findOne({
      organizationId: interview.organizationId,
      interviewId: interview._id,
      idempotencyKey,
    });
    if (existing) {
      return {
        submission: serializeSubmission(existing, { isCandidate: participant.isCandidate }),
        message: "Submission retrieved via idempotency key.",
        isDuplicate: true,
      };
    }
  }

  // Calculate sequence number for this interview & question
  const count = await Submission.countDocuments({
    interviewId: interview._id,
    questionId: questionSnapshot.questionId,
  });
  const sequenceNumber = count + 1;

  // Prepare test cases for execution
  let testCases = [];
  if (!isDraftSave) {
    const publicTests = (questionSnapshot.publicTests || []).map((t, idx) => ({
      testIndex: idx + 1,
      input: t.input,
      expectedOutput: t.expectedOutput,
      visibility: "public",
    }));

    if (effectiveSubmissionType === SUBMISSION_TYPE.RUN) {
      // "Run Code" evaluates only public test cases
      testCases = publicTests;
    } else {
      // "Submit Solution" evaluates both public and hidden test cases
      const hiddenTests = (questionSnapshot.hiddenTests || []).map((t, idx) => ({
        testIndex: publicTests.length + idx + 1,
        input: t.input,
        expectedOutput: t.expectedOutput,
        visibility: "hidden",
      }));
      testCases = [...publicTests, ...hiddenTests];
    }
  }

  const initialExecutionResult = isDraftSave
    ? null
    : {
        status: EXECUTION_STATUS.QUEUED,
        passedCount: 0,
        failedCount: 0,
        totalCount: testCases.length,
        durationMs: 0,
        peakMemoryKb: 0,
        compileOutput: "",
        stderr: "",
        stdout: "",
        errorMessage: "",
        executedAt: null,
        testResults: [],
      };

  const submission = new Submission({
    organizationId: interview.organizationId,
    interviewId: interview._id,
    questionId: questionSnapshot.questionId,
    questionVersion: questionSnapshot.version || 1,
    candidateUserId: participant.isCandidate
      ? participant.userId || null
      : interview.candidate?.userId || null,
    candidateName: participant.isCandidate
      ? participant.name
      : interview.candidate?.name || "",
    candidateEmail: participant.isCandidate
      ? participant.email
      : interview.candidate?.email || "",
    language,
    sourceCode,
    documentVersion,
    submissionType: effectiveSubmissionType,
    idempotencyKey,
    status: effectiveStatus,
    sequenceNumber,
    submittedBy: {
      id: participant.id,
      name: participant.name,
      role: participant.role,
    },
    executionResult: initialExecutionResult,
  });

  await submission.save();

  // Enqueue execution job in BullMQ if this is an execution request
  if (!isDraftSave) {
    await enqueueExecutionJob(
      {
        submissionId: submission._id,
        interviewId: interview._id,
        organizationId: interview.organizationId,
        questionId: questionSnapshot.questionId,
        language,
        sourceCode,
        submissionType: effectiveSubmissionType,
        timeLimitMs: questionSnapshot.timeLimitMs || 2000,
        memoryLimitMb: questionSnapshot.memoryLimitMb || 256,
        testCases,
      },
      injectedQueue,
    );
  }

  const serialized = serializeSubmission(submission, {
    isCandidate: participant.isCandidate,
  });

  // Real-time broadcast
  if (io) {
    const eventName = isDraftSave
      ? "submission:saved"
      : "submission:queued";

    io.to(`interview:${interviewId}`).emit(eventName, {
      interviewId: String(interviewId),
      questionId: String(questionId),
      submission: serialized,
      timestamp: new Date().toISOString(),
    });
  }

  const message = isDraftSave
    ? "Draft saved successfully."
    : effectiveSubmissionType === SUBMISSION_TYPE.RUN
      ? "Code run enqueued for execution."
      : "Solution submitted and queued for test evaluation.";

  return {
    submission: serialized,
    message,
    isDuplicate: false,
  };
}

/**
 * List submissions for an interview question.
 */
export async function listSubmissions({
  interviewId,
  questionId,
  reqContext,
}) {
  const { interview, participant } = await authorizeInterviewAccess(
    interviewId,
    reqContext,
  );

  const filter = {
    interviewId: interview._id,
    organizationId: interview.organizationId,
  };

  if (questionId) {
    if (!mongoose.isValidObjectId(questionId)) {
      throw new AppError("Invalid question ID", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    filter.questionId = new mongoose.Types.ObjectId(questionId);
  }

  // Candidate isolation: candidates can only see their own submissions!
  if (participant.isCandidate) {
    filter.$or = [
      { "submittedBy.id": participant.id },
      { candidateEmail: participant.email },
    ];
  }

  const submissions = await Submission.find(filter)
    .sort({ createdAt: -1 })
    .lean();

  return {
    submissions: submissions.map((sub) =>
      serializeSubmission(sub, { isCandidate: participant.isCandidate }),
    ),
    count: submissions.length,
  };
}

/**
 * Retrieve a specific submission by ID with role-based test case masking.
 */
export async function getSubmissionById(submissionId, reqContext) {
  if (!mongoose.isValidObjectId(submissionId)) {
    throw notFound();
  }

  const submission = await Submission.findById(submissionId).lean();
  if (!submission) {
    throw notFound();
  }

  const { participant } = await authorizeInterviewAccess(
    submission.interviewId,
    reqContext,
  );

  // Candidate isolation
  if (participant.isCandidate) {
    const isOwn =
      submission.submittedBy?.id === participant.id ||
      submission.candidateEmail === participant.email;
    if (!isOwn) {
      throw forbidden("You can only access your own submissions");
    }
  }

  return {
    submission: serializeSubmission(submission, {
      isCandidate: participant.isCandidate,
    }),
  };
}

/**
 * Lightweight endpoint for polling submission status & execution results.
 */
export async function getSubmissionStatus(submissionId, reqContext) {
  const result = await getSubmissionById(submissionId, reqContext);
  return {
    id: result.submission.id,
    status: result.submission.status,
    submissionType: result.submission.submissionType,
    executionResult: result.submission.executionResult,
  };
}

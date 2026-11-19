import mongoose from "mongoose";
import {
  SUPPORTED_LANGUAGES,
  SUBMISSION_LIFECYCLE,
  SUBMISSION_TYPE,
  EXECUTION_STATUS,
} from "@platform/shared";

export const SUBMISSION_STATUS = Object.freeze({
  ...SUBMISSION_LIFECYCLE,
  SUBMITTED: "submitted", // Backwards compatibility for Phase 3 snapshots
});

const TestCaseResultSchema = new mongoose.Schema(
  {
    testIndex: { type: Number, required: true },
    visibility: { type: String, enum: ["public", "hidden"], default: "public" },
    status: { type: String, enum: Object.values(EXECUTION_STATUS), required: true },
    passed: { type: Boolean, required: true },
    input: { type: String, default: "" },
    expectedOutput: { type: String, default: "" },
    actualOutput: { type: String, default: "" },
    compileOutput: { type: String, default: "" },
    stderr: { type: String, default: "" },
    durationMs: { type: Number, default: 0 },
    memoryKb: { type: Number, default: 0 },
  },
  { _id: false },
);

const ExecutionResultSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: Object.values(EXECUTION_STATUS),
      default: EXECUTION_STATUS.QUEUED,
      required: true,
    },
    passedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    totalCount: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    peakMemoryKb: { type: Number, default: 0 },
    compileOutput: { type: String, default: "" },
    stderr: { type: String, default: "" },
    stdout: { type: String, default: "" },
    errorMessage: { type: String, default: "" },
    executedAt: { type: Date, default: null },
    testResults: [TestCaseResultSchema],
  },
  { _id: false },
);

const SubmissionSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    interviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Interview",
      required: true,
      index: true,
    },
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
      index: true,
    },
    questionVersion: {
      type: Number,
      default: 1,
    },
    candidateUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    candidateName: {
      type: String,
      default: "",
    },
    candidateEmail: {
      type: String,
      default: "",
      lowercase: true,
      trim: true,
    },
    language: {
      type: String,
      enum: SUPPORTED_LANGUAGES,
      required: true,
    },
    sourceCode: {
      type: String,
      required: true,
      maxlength: 131072, // 128 KB
    },
    documentVersion: {
      type: Number,
      default: 1,
    },
    submissionType: {
      type: String,
      enum: Object.values(SUBMISSION_TYPE),
      default: SUBMISSION_TYPE.SUBMIT,
    },
    idempotencyKey: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(SUBMISSION_STATUS),
      default: SUBMISSION_STATUS.SAVED,
      required: true,
    },
    sequenceNumber: {
      type: Number,
      required: true,
    },
    submittedBy: {
      id: { type: String, required: true },
      name: { type: String, required: true },
      role: { type: String, required: true },
    },
    executionResult: {
      type: ExecutionResultSchema,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

SubmissionSchema.index(
  { organizationId: 1, interviewId: 1, idempotencyKey: 1 },
  { sparse: true },
);
SubmissionSchema.index({ interviewId: 1, questionId: 1, createdAt: -1 });
SubmissionSchema.index({ interviewId: 1, createdAt: -1 });
SubmissionSchema.index({ interviewId: 1, questionId: 1, status: 1, createdAt: -1 });

export const Submission = mongoose.model("Submission", SubmissionSchema);

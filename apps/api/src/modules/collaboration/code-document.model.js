import mongoose from "mongoose";

const CodeDocumentSchema = new mongoose.Schema(
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
    language: {
      type: String,
      default: "javascript",
    },
    yjsState: {
      type: Buffer,
      default: null,
    },
    text: {
      type: String,
      default: "",
    },
    version: {
      type: Number,
      default: 1,
    },
    lastSavedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

CodeDocumentSchema.index(
  { interviewId: 1, questionId: 1 },
  { unique: true },
);

export const CodeDocument = mongoose.model(
  "CodeDocument",
  CodeDocumentSchema,
);

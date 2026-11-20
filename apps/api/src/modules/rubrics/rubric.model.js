import mongoose from "mongoose";

const CriterionSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true, maxlength: 64 },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: "", maxlength: 1000 },
  required: { type: Boolean, default: true },
  weight: { type: Number, required: true, min: 0, max: 100 },
}, { _id: false, strict: "throw" });

const RubricVersionSchema = new mongoose.Schema({
  version: { type: Number, required: true, min: 1 },
  name: { type: String, required: true, maxlength: 180 },
  description: { type: String, default: "", maxlength: 2000 },
  jobRole: { type: String, default: "", maxlength: 180 },
  assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", default: null },
  scale: {
    min: { type: Number, required: true, min: 1, max: 10 },
    max: { type: Number, required: true, min: 1, max: 10 },
    labels: { type: Map, of: String, default: () => new Map() },
  },
  criteria: { type: [CriterionSchema], required: true },
  changeSummary: { type: String, default: "", maxlength: 500 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, required: true, default: Date.now },
}, { _id: false, strict: "throw" });

const EvaluationRubricSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
  status: { type: String, enum: ["active", "archived"], default: "active", required: true },
  currentVersion: { type: Number, required: true, default: 1, min: 1 },
  versions: { type: [RubricVersionSchema], required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  archivedAt: { type: Date, default: null },
}, { timestamps: true, optimisticConcurrency: true, strict: "throw" });

EvaluationRubricSchema.index({ organizationId: 1, status: 1, updatedAt: -1 });
EvaluationRubricSchema.index({ organizationId: 1, _id: 1 });

// Only the service creates new rubric versions via a conditional atomic $push.
// Consumers of snapshots must copy the immutable version at first scorecard creation.
export const EvaluationRubric = mongoose.model("EvaluationRubric", EvaluationRubricSchema);

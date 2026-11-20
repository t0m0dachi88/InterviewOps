import mongoose from "mongoose";
import { ERROR_CODES } from "@platform/shared";
import { AppError } from "../../middleware/error.middleware.js";
import { Assessment } from "../assessments/assessment.model.js";
import { EvaluationRubric } from "./rubric.model.js";

const notFound = () => new AppError("Rubric not found", 404, ERROR_CODES.NOT_FOUND);
const conflict = () => new AppError("Rubric changed or was archived; reload the latest version", 409, ERROR_CODES.CONFLICT);
function validId(id) { if (!mongoose.isValidObjectId(id)) throw notFound(); }
async function verifyAssessment(organizationId, assessmentId) {
  if (!assessmentId) return;
  const found = await Assessment.exists({ _id: assessmentId, organizationId });
  if (!found) throw new AppError("Assessment not found in this organization", 400, ERROR_CODES.VALIDATION_ERROR);
}
function makeVersion(data, version, userId) {
  return { ...data, version, createdBy: userId, createdAt: new Date() };
}
export function serializeRubric(doc, requestedVersion) {
  const r = doc.toObject ? doc.toObject({ flattenMaps: true }) : doc;
  const version = requestedVersion ?? r.currentVersion;
  const selected = r.versions.find((v) => v.version === version);
  if (!selected) throw notFound();
  return {
    id: String(r._id), organizationId: String(r.organizationId), status: r.status,
    currentVersion: r.currentVersion, activeVersion: version,
    name: selected.name, description: selected.description, jobRole: selected.jobRole,
    assessmentId: selected.assessmentId ? String(selected.assessmentId) : null,
    scale: { min: selected.scale.min, max: selected.scale.max, labels: Object.fromEntries(Object.entries(selected.scale.labels || {})) },
    criteria: selected.criteria.map(({ key, label, description, required, weight }) => ({ key, label, description, required, weight })),
    changeSummary: selected.changeSummary,
    versionCreatedBy: String(selected.createdBy), versionCreatedAt: selected.createdAt,
    createdBy: String(r.createdBy), updatedBy: String(r.updatedBy),
    archivedAt: r.archivedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
export async function createRubric(organizationId, userId, data) {
  await verifyAssessment(organizationId, data.assessmentId);
  const rubric = await EvaluationRubric.create({
    organizationId, status: "active", currentVersion: 1,
    versions: [makeVersion(data, 1, userId)], createdBy: userId, updatedBy: userId,
  });
  return serializeRubric(rubric);
}
export async function listRubrics(organizationId, { status, page, limit }) {
  const filter = { organizationId, ...(status === "all" ? {} : { status }) };
  const [rubrics, total] = await Promise.all([
    EvaluationRubric.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    EvaluationRubric.countDocuments(filter),
  ]);
  return { rubrics: rubrics.map((r) => serializeRubric(r)), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}
export async function getRubric(organizationId, rubricId, version) {
  validId(rubricId);
  const rubric = await EvaluationRubric.findOne({ _id: rubricId, organizationId }).lean();
  if (!rubric) throw notFound();
  return serializeRubric(rubric, version);
}
export async function getRubricVersions(organizationId, rubricId) {
  validId(rubricId);
  const rubric = await EvaluationRubric.findOne({ _id: rubricId, organizationId }).lean();
  if (!rubric) throw notFound();
  return { rubricId: String(rubric._id), currentVersion: rubric.currentVersion, versions: rubric.versions.map((v) => ({ version: v.version, name: v.name, changeSummary: v.changeSummary, createdBy: String(v.createdBy), createdAt: v.createdAt })) };
}
export async function createRubricVersion(organizationId, rubricId, userId, expectedVersion, data) {
  validId(rubricId);
  await verifyAssessment(organizationId, data.assessmentId);
  // Conditional single-document update prevents lost updates and never rewrites history.
  const changed = await EvaluationRubric.findOneAndUpdate(
    { _id: rubricId, organizationId, status: "active", currentVersion: expectedVersion },
    { $push: { versions: makeVersion(data, expectedVersion + 1, userId) }, $inc: { currentVersion: 1 }, $set: { updatedBy: userId } },
    { new: true, runValidators: true },
  );
  if (changed) return serializeRubric(changed);
  const exists = await EvaluationRubric.exists({ _id: rubricId, organizationId });
  if (!exists) throw notFound();
  throw conflict();
}
export async function archiveRubric(organizationId, rubricId, userId) {
  validId(rubricId);
  const changed = await EvaluationRubric.findOneAndUpdate(
    { _id: rubricId, organizationId, status: "active" },
    { $set: { status: "archived", archivedAt: new Date(), archivedBy: userId, updatedBy: userId } },
    { new: true, runValidators: true },
  );
  if (changed) return serializeRubric(changed);
  const exists = await EvaluationRubric.exists({ _id: rubricId, organizationId });
  if (!exists) throw notFound();
  throw conflict();
}

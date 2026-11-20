import mongoose from "mongoose";
import { ERROR_CODES } from "@platform/shared";
import { AppError } from "../../middleware/error.middleware.js";

const fail = (message) => { throw new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR); };
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function assertKeys(data, allowed) {
  if (!isPlainObject(data)) fail("Body must be an object");
  for (const key of Object.keys(data)) if (!allowed.includes(key)) fail(`Unexpected field: ${key}`);
}
function string(value, field, max, { required = false } = {}) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || (required && !value.trim()) || value.trim().length > max) fail(`Invalid ${field}`);
  return value.trim();
}
function parseScale(scale) {
  if (scale === undefined) return { min: 1, max: 5, labels: { "1": "Poor", "2": "Below expectations", "3": "Meets expectations", "4": "Strong", "5": "Excellent" } };
  assertKeys(scale, ["min", "max", "labels"]);
  if (!Number.isInteger(scale.min) || !Number.isInteger(scale.max) || scale.min < 1 || scale.max > 10 || scale.min >= scale.max) fail("Scoring scale must be increasing integers within 1–10");
  const labels = scale.labels ?? {};
  if (!isPlainObject(labels)) fail("Scale labels must be an object");
  for (const [key, value] of Object.entries(labels)) {
    if (!Number.isInteger(Number(key)) || String(Number(key)) !== key || Number(key) < scale.min || Number(key) > scale.max) fail("Invalid scale label key");
    string(value, `scale label ${key}`, 100, { required: true });
  }
  return { min: scale.min, max: scale.max, labels };
}
function parseCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length < 1 || criteria.length > 30) fail("Criteria must contain 1–30 entries");
  const keys = new Set();
  const parsed = criteria.map((criterion) => {
    assertKeys(criterion, ["key", "label", "description", "required", "weight"]);
    const key = string(criterion.key, "criterion key", 64, { required: true });
    if (!/^[a-z][a-z0-9_]*$/.test(key) || keys.has(key)) fail("Criterion keys must be unique lowercase identifiers");
    keys.add(key);
    const weight = criterion.weight === undefined ? 1 : criterion.weight;
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 100) fail("Criterion weights must be between 0 and 100");
    if (criterion.required !== undefined && typeof criterion.required !== "boolean") fail("Criterion required must be boolean");
    return {
      key, label: string(criterion.label, "criterion label", 120, { required: true }),
      description: string(criterion.description, "criterion description", 1000),
      required: criterion.required ?? true, weight,
    };
  });
  if (!parsed.some((c) => c.weight > 0)) fail("At least one criterion must have a positive weight");
  return parsed;
}
export function validateRubricContent(body) {
  assertKeys(body, ["name", "description", "jobRole", "assessmentId", "scale", "criteria", "changeSummary", "expectedVersion"]);
  const assessmentId = body.assessmentId ?? null;
  if (assessmentId !== null && !mongoose.isValidObjectId(assessmentId)) fail("Invalid assessment ID");
  return {
    name: string(body.name, "rubric name", 180, { required: true }),
    description: string(body.description, "rubric description", 2000),
    jobRole: string(body.jobRole, "job role", 180),
    assessmentId,
    scale: parseScale(body.scale),
    criteria: parseCriteria(body.criteria),
    changeSummary: string(body.changeSummary, "change summary", 500),
  };
}
export function validateRubricCreate(req, _res, next) {
  try { req.validated = validateRubricContent(req.body); next(); } catch (error) { next(error); }
}
export function validateRubricVersion(req, _res, next) {
  try {
    if (!Number.isSafeInteger(req.body?.expectedVersion) || req.body.expectedVersion < 1) fail("expectedVersion is required and must be a positive integer");
    req.expectedVersion = req.body.expectedVersion;
    req.validated = validateRubricContent(req.body);
    next();
  } catch (error) { next(error); }
}
export function validateRubricList(req, _res, next) {
  try {
    const { status = "active", page = "1", limit = "20" } = req.query;
    if (!["active", "archived", "all"].includes(status)) fail("Invalid rubric status filter");
    if (!/^\d+$/.test(String(page)) || !/^\d+$/.test(String(limit))) fail("Invalid pagination");
    const p = Number(page), l = Number(limit);
    if (p < 1 || p > 100000 || l < 1 || l > 100) fail("Pagination out of range");
    req.rubricListQuery = { status, page: p, limit: l };
    next();
  } catch (error) { next(error); }
}

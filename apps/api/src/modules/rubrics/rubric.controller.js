import { createSuccessEnvelope, ERROR_CODES } from "@platform/shared";
import { asyncHandler } from "../../utils/async-handler.js";
import { AppError } from "../../middleware/error.middleware.js";
import * as rubrics from "./rubric.service.js";

function versionQuery(raw) {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new AppError("Invalid rubric version", 400, ERROR_CODES.VALIDATION_ERROR);
  }
  return Number(raw);
}
export const RubricController = {
  create: asyncHandler(async (req, res) => res.status(201).json(createSuccessEnvelope({ rubric: await rubrics.createRubric(req.organization.id, req.user.id, req.validated) }))),
  list: asyncHandler(async (req, res) => {
    const result = await rubrics.listRubrics(req.organization.id, req.rubricListQuery);
    return res.json(createSuccessEnvelope({ rubrics: result.rubrics }, { pagination: result.pagination }));
  }),
  get: asyncHandler(async (req, res) => res.json(createSuccessEnvelope({ rubric: await rubrics.getRubric(req.organization.id, req.params.rubricId, versionQuery(req.query.version)) }))),
  versions: asyncHandler(async (req, res) => res.json(createSuccessEnvelope(await rubrics.getRubricVersions(req.organization.id, req.params.rubricId)))),
  newVersion: asyncHandler(async (req, res) => res.json(createSuccessEnvelope({ rubric: await rubrics.createRubricVersion(req.organization.id, req.params.rubricId, req.user.id, req.expectedVersion, req.validated) }))),
  archive: asyncHandler(async (req, res) => res.json(createSuccessEnvelope({ rubric: await rubrics.archiveRubric(req.organization.id, req.params.rubricId, req.user.id) }))),
};

import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requireOrganization } from "../../middleware/authorize-organization.middleware.js";
import { PERMISSIONS } from "../organizations/permissions.js";
import { RubricController } from "./rubric.controller.js";
import { validateRubricCreate, validateRubricVersion, validateRubricList } from "./rubric.validation.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.post("/", requireOrganization(PERMISSIONS.RUBRIC_MANAGE), validateRubricCreate, RubricController.create);
router.get("/", requireOrganization(PERMISSIONS.RUBRIC_VIEW), validateRubricList, RubricController.list);
router.get("/:rubricId", requireOrganization(PERMISSIONS.RUBRIC_VIEW), RubricController.get);
router.get("/:rubricId/versions", requireOrganization(PERMISSIONS.RUBRIC_VIEW), RubricController.versions);
router.patch("/:rubricId", requireOrganization(PERMISSIONS.RUBRIC_MANAGE), validateRubricVersion, RubricController.newVersion);
router.post("/:rubricId/versions", requireOrganization(PERMISSIONS.RUBRIC_MANAGE), validateRubricVersion, RubricController.newVersion);
router.post("/:rubricId/archive", requireOrganization(PERMISSIONS.RUBRIC_MANAGE), RubricController.archive);
export default router;

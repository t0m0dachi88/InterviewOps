import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware.js";
import { requireOrganization } from "../../middleware/authorize-organization.middleware.js";
import {
  createInterviewHandler,
  listInterviewsHandler,
  getInterviewHandler,
  updateInterviewHandler,
  cancelInterviewHandler,
  transitionStatusHandler,
  assignInterviewersHandler,
} from "./interview.controller.js";

const router = Router({ mergeParams: true });

// All organization interview management routes require authentication and org membership
router.use(authenticate);
router.use(requireOrganization());

router.post("/", createInterviewHandler);
router.get("/", listInterviewsHandler);
router.get("/:interviewId", getInterviewHandler);
router.patch("/:interviewId", updateInterviewHandler);
router.post("/:interviewId/cancel", cancelInterviewHandler);
router.post("/:interviewId/status", transitionStatusHandler);
router.post("/:interviewId/interviewers", assignInterviewersHandler);

export default router;

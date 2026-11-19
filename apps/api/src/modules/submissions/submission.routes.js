import { Router } from "express";
import { authenticateParticipant } from "../../middleware/authenticate-participant.middleware.js";
import {
  createSubmissionHandler,
  listSubmissionsHandler,
  getSubmissionByIdHandler,
  getSubmissionStatusHandler,
} from "./submission.controller.js";

const router = Router({ mergeParams: true });

router.post(
  "/interviews/:interviewId/questions/:questionId/submissions",
  authenticateParticipant,
  createSubmissionHandler,
);

router.get(
  "/interviews/:interviewId/questions/:questionId/submissions",
  authenticateParticipant,
  listSubmissionsHandler,
);

router.get(
  "/submissions/:submissionId/status",
  authenticateParticipant,
  getSubmissionStatusHandler,
);

router.get(
  "/submissions/:submissionId",
  authenticateParticipant,
  getSubmissionByIdHandler,
);


export default router;

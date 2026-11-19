import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware.js";
import {
  inviteCandidateHandler,
  getInvitationByTokenHandler,
  acceptInvitationHandler,
  exchangeJoinTokenHandler,
} from "./candidate-invitation.controller.js";

const router = Router();

// Public routes for candidates
router.get("/candidate-invitations/:token", getInvitationByTokenHandler);
router.post("/candidate-invitations/:token/accept", acceptInvitationHandler);

// Interviewer scoped candidate invitation route
router.post(
  "/interviews/:interviewId/invitations",
  authenticate,
  inviteCandidateHandler,
);

// Exchange invitation token for candidate room token
router.post("/interviews/:interviewId/join-token", exchangeJoinTokenHandler);

export default router;

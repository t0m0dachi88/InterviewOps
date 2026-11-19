import { Router } from "express";
import { authenticateParticipant } from "../../middleware/authenticate-participant.middleware.js";
import {
  getRoom,
  joinRoom,
  leaveRoom,
  getActiveQuestionHandler,
  setActiveQuestionHandler,
} from "./interview-room.controller.js";

const router = Router({ mergeParams: true });

// All room routes require participant authentication (team member or candidate)
router.use(authenticateParticipant);

router.get("/room", getRoom);
router.post("/room/join", joinRoom);
router.post("/room/leave", leaveRoom);

router.get("/active-question", getActiveQuestionHandler);
router.patch("/active-question", setActiveQuestionHandler);

export default router;

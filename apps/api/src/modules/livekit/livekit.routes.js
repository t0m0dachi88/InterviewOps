import { Router } from "express";
import { authenticateParticipant } from "../../middleware/authenticate-participant.middleware.js";
import { getLiveKitTokenHandler } from "./livekit.controller.js";

const router = Router({ mergeParams: true });

router.use(authenticateParticipant);
router.post("/token", getLiveKitTokenHandler);

export default router;

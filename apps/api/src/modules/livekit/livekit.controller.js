import { asyncHandler } from "../../utils/async-handler.js";
import { sendSuccess } from "../../utils/response.js";
import { generateLiveKitToken } from "./livekit.service.js";

export const getLiveKitTokenHandler = asyncHandler(async (req, res) => {
  const { interviewId } = req.params;
  const result = await generateLiveKitToken(interviewId, {
    participantType: req.participantType,
    user: req.user,
    candidate: req.candidate,
  });

  return sendSuccess(res, result);
});


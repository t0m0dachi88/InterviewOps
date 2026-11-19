import { AccessToken } from "livekit-server-sdk";
import { env } from "../../config/env.js";
import { authorizeInterviewAccess } from "../interview-room/interview-room.service.js";

const DEFAULT_DEV_KEY = "devkey";
const DEFAULT_DEV_SECRET = "dev-secret-at-least-32-chars-long-1234567890";

/**
 * Generate a short-lived LiveKit participant token for voice and video.
 *
 * @param {string} interviewId
 * @param {object} reqContext - Request auth context { participantType, user, candidate }
 * @returns {Promise<{ token: string, serverUrl: string, roomName: string, isConfigured: boolean, notice?: string }>}
 */
export async function generateLiveKitToken(interviewId, reqContext) {
  const { interview, participant } = await authorizeInterviewAccess(
    interviewId,
    reqContext,
  );

  const roomName = `interview_${interview._id}`;
  const isCandidate = participant.isCandidate;

  const apiKey = env.LIVEKIT_API_KEY || (env.isProduction ? "" : DEFAULT_DEV_KEY);
  const apiSecret =
    env.LIVEKIT_API_SECRET || (env.isProduction ? "" : DEFAULT_DEV_SECRET);
  const isConfigured = Boolean(env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participant.id,
    name: participant.name,
    ttl: "2h",
    metadata: JSON.stringify({
      role: participant.role,
      isCandidate,
      interviewId: String(interview._id),
    }),
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: !isCandidate,
  });

  const token = await at.toJwt();

  const result = {
    token,
    serverUrl: env.LIVEKIT_URL || "wss://demo.livekit.cloud",
    roomName,
    isConfigured,
  };

  if (!isConfigured) {
    result.notice =
      "LiveKit service credentials not configured. Media connection operates in local preview/development mode.";
  }

  return result;
}

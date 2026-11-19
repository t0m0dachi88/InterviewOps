import { ERROR_CODES, USER_STATUS } from "@platform/shared";
import { AppError } from "./error.middleware.js";
import { asyncHandler } from "../utils/async-handler.js";
import { User } from "../modules/auth/user.model.js";
import { Session } from "../modules/auth/session.model.js";
import {
  verifyAccessToken,
  verifyCandidateRoomToken,
} from "../modules/auth/token.service.js";

function extractBearerToken(req) {
  const header = req.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Authenticates either an organization team member (user JWT) or a candidate (candidate room JWT).
 */
export const authenticateParticipant = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw new AppError(
      "Authentication required",
      401,
      ERROR_CODES.UNAUTHORIZED,
    );
  }

  // 1. Try candidate room token
  try {
    const candidatePayload = verifyCandidateRoomToken(token);
    req.participantType = "candidate";
    req.candidate = {
      interviewId: candidatePayload.interviewId,
      name: candidatePayload.candidateName,
      email: candidatePayload.candidateEmail,
      userId: candidatePayload.candidateUserId || null,
      role: "candidate",
    };
    return next();
  } catch {
    // Not a candidate room token; continue to user access token check
  }

  // 2. Try standard user access token
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new AppError(
      "Authentication required",
      401,
      ERROR_CODES.UNAUTHORIZED,
    );
  }

  const userId = payload.sub;
  const sessionId = payload.sid;
  if (!userId || !sessionId) {
    throw new AppError(
      "Authentication required",
      401,
      ERROR_CODES.UNAUTHORIZED,
    );
  }

  const [user, session] = await Promise.all([
    User.findById(userId),
    Session.findById(sessionId),
  ]);

  if (!user || user.status !== USER_STATUS.ACTIVE) {
    throw new AppError(
      "Authentication required",
      401,
      ERROR_CODES.UNAUTHORIZED,
    );
  }

  if (
    !session ||
    String(session.userId) !== String(user._id) ||
    session.revokedAt ||
    session.expiresAt.getTime() <= Date.now()
  ) {
    throw new AppError(
      "Authentication required",
      401,
      ERROR_CODES.UNAUTHORIZED,
    );
  }

  req.participantType = "team_member";
  req.user = {
    id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    sessionId: String(session._id),
  };
  req.authUser = user;
  req.authSession = session;
  next();
});

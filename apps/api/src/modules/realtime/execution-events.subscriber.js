import { Redis } from "ioredis";
import { getRedisConnectionOptions } from "../../config/redis.js";
import { env } from "../../config/env.js";

let subscriberClient = null;

/**
 * Initializes Redis Pub/Sub subscription to stream worker execution results to Socket.IO rooms.
 *
 * @param {import("socket.io").Server} io
 * @returns {Promise<Redis | null>}
 */
export async function initExecutionEventsSubscriber(io) {
  if (subscriberClient) {
    return subscriberClient;
  }

  if (!env.redis.isConfigured || env.isTest) {
    return null;
  }

  try {
    const options = getRedisConnectionOptions();
    subscriberClient = new Redis(options);

    await subscriberClient.subscribe("submission:events");

    subscriberClient.on("message", (channel, message) => {
      if (channel !== "submission:events" || !message) return;

      try {
        const data = JSON.parse(message);
        const {
          event,
          interviewId,
          questionId,
          submissionId,
          status,
          submissionType,
          executionResult,
          timestamp,
        } = data;

        if (!interviewId || !io) return;

        // Candidate-safe serialization for room broadcast (hidden tests masked)
        let candidateSafeResult = null;
        if (executionResult) {
          candidateSafeResult = {
            ...executionResult,
            stderr: "", // Do not broadcast internal execution stderr to candidate
            testResults: (executionResult.testResults || []).map((tr) => {
              if (tr.visibility === "hidden") {
                return {
                  testIndex: tr.testIndex,
                  visibility: "hidden",
                  status: tr.status,
                  passed: tr.passed,
                  durationMs: tr.durationMs || 0,
                };
              }
              return tr;
            }),
          };
        }

        io.to(`interview:${interviewId}`).emit(event, {
          interviewId,
          questionId,
          submissionId,
          status,
          submissionType,
          executionResult: candidateSafeResult,
          timestamp: timestamp || new Date().toISOString(),
        });
      } catch (err) {
        if (env.LOG_LEVEL !== "silent") {
          // eslint-disable-next-line no-console
          console.warn("Failed to process submission event message:", err.message);
        }
      }
    });

    if (env.LOG_LEVEL !== "silent") {
      // eslint-disable-next-line no-console
      console.log("Subscribed to Redis submission:events channel.");
    }

    return subscriberClient;
  } catch (err) {
    if (env.LOG_LEVEL !== "silent") {
      // eslint-disable-next-line no-console
      console.warn("Could not bind Redis subscriber for execution events:", err.message);
    }
    return null;
  }
}

export async function closeExecutionEventsSubscriber() {
  if (subscriberClient) {
    try {
      await subscriberClient.quit();
    } catch {
      // ignore
    }
    subscriberClient = null;
  }
}

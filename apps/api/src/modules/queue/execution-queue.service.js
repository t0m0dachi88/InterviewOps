import { Queue } from "bullmq";
import { getBullMQConnectionOptions } from "../../config/redis.js";
import { env } from "../../config/env.js";

export const QUEUE_NAMES = Object.freeze({
  CODE_EXECUTION: "code-execution",
});

let executionQueue = null;

/**
 * Returns the BullMQ queue instance for code execution.
 *
 * @param {object} [customConnection] - For dependency injection in tests
 * @returns {Queue | null}
 */
export function getExecutionQueue(customConnection = null) {
  if (executionQueue) {
    return executionQueue;
  }

  // If in test environment without Redis or custom connection, return null or mock
  if (env.isTest && !customConnection) {
    return null;
  }

  try {
    const connection = customConnection || getBullMQConnectionOptions();
    executionQueue = new Queue(QUEUE_NAMES.CODE_EXECUTION, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });

    return executionQueue;
  } catch (err) {
    if (env.LOG_LEVEL !== "silent" && !env.isTest) {
      // eslint-disable-next-line no-console
      console.warn("Could not initialize BullMQ execution queue:", err.message);
    }
    return null;
  }
}

/**
 * Enqueue a code execution job into BullMQ.
 *
 * @param {object} jobData
 * @param {string} jobData.submissionId
 * @param {string} jobData.interviewId
 * @param {string} jobData.organizationId
 * @param {string} jobData.questionId
 * @param {string} jobData.language
 * @param {string} jobData.sourceCode
 * @param {string} jobData.submissionType - "run" or "submit"
 * @param {number} [jobData.timeLimitMs]
 * @param {number} [jobData.memoryLimitMb]
 * @param {Array<{ testIndex: number, input: string, expectedOutput: string, visibility: string }>} jobData.testCases
 * @param {Queue} [injectedQueue]
 * @returns {Promise<{ enqueued: boolean, jobId: string }>}
 */
export async function enqueueExecutionJob(jobData, injectedQueue = null) {
  const queue = injectedQueue || getExecutionQueue();
  const jobId = `sub_${jobData.submissionId}`;

  if (!queue) {
    return {
      enqueued: false,
      jobId,
      message: "Queue not available in current environment",
    };
  }

  const job = await queue.add(
    "execute-submission",
    {
      submissionId: String(jobData.submissionId),
      interviewId: String(jobData.interviewId),
      organizationId: String(jobData.organizationId),
      questionId: String(jobData.questionId),
      language: jobData.language,
      sourceCode: jobData.sourceCode,
      submissionType: jobData.submissionType || "submit",
      timeLimitMs: jobData.timeLimitMs || 2000,
      memoryLimitMb: jobData.memoryLimitMb || 256,
      testCases: jobData.testCases || [],
      enqueuedAt: new Date().toISOString(),
    },
    {
      jobId,
    },
  );

  return {
    enqueued: true,
    jobId: job.id,
  };
}

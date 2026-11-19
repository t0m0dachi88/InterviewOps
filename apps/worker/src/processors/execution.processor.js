import { Redis } from "ioredis";
import { EXECUTION_STATUS, SUBMISSION_LIFECYCLE } from "@platform/shared";
import { Submission } from "../models/submission.model.js";
import { Judge0ExecutionProvider } from "../providers/judge0.provider.js";
import { workerEnv } from "../config/env.js";
import { getWorkerRedisOptions } from "../config/redis.js";

let redisPublisher = null;

function getRedisPublisher() {
  if (redisPublisher) return redisPublisher;
  if (!workerEnv.redis.isConfigured) return null;
  try {
    const opts = getWorkerRedisOptions();
    redisPublisher = new Redis(opts);
    return redisPublisher;
  } catch {
    return null;
  }
}

/**
 * Process a single code execution job from BullMQ.
 *
 * @param {import('bullmq').Job} job
 * @param {object} [options]
 * @param {import('../providers/execution-provider.interface.js').ExecutionProvider} [options.provider]
 * @param {Redis} [options.publisher]
 * @returns {Promise<object>}
 */
export async function processExecutionJob(job, options = {}) {
  const {
    submissionId,
    interviewId,
    questionId,
    language,
    sourceCode,
    submissionType = "submit",
    timeLimitMs = 2000,
    memoryLimitMb = 256,
    testCases = [],
  } = job.data;

  // Select provider (dependency injection for tests or fallback to Judge0)
  const provider =
    options.provider ||
    new Judge0ExecutionProvider({
      baseUrl: workerEnv.judge0.url,
      apiKey: workerEnv.judge0.apiKey,
      languageMap: workerEnv.judge0.languages,
    });

  const publisher = options.publisher || getRedisPublisher();

  // 1. Mark submission as processing
  try {
    await Submission.findByIdAndUpdate(submissionId, {
      status: SUBMISSION_LIFECYCLE.PROCESSING,
      submissionType,
    });
  } catch {
    // Non-fatal if DB update fails or running in disconnected test mode
  }

  // 2. Execute code against test cases
  let executionResult;
  let finalLifecycle = SUBMISSION_LIFECYCLE.COMPLETED;

  try {
    const rawResult = await provider.execute({
      sourceCode,
      language,
      testCases,
      timeLimitMs,
      memoryLimitMb,
    });

    executionResult = {
      status: rawResult.status,
      passedCount: rawResult.passedCount || 0,
      failedCount: rawResult.failedCount || 0,
      totalCount: rawResult.totalCount || testCases.length,
      durationMs: rawResult.durationMs || 0,
      peakMemoryKb: rawResult.peakMemoryKb || 0,
      compileOutput: rawResult.compileOutput || "",
      stderr: rawResult.stderr || "",
      stdout: rawResult.stdout || "",
      errorMessage: "",
      executedAt: new Date(),
      testResults: rawResult.testResults || [],
    };
  } catch (err) {
    // Infrastructure / Judge0 error
    finalLifecycle = SUBMISSION_LIFECYCLE.FAILED;
    executionResult = {
      status: EXECUTION_STATUS.SYSTEM_ERROR,
      passedCount: 0,
      failedCount: testCases.length,
      totalCount: testCases.length,
      durationMs: 0,
      peakMemoryKb: 0,
      compileOutput: "",
      stderr: "",
      stdout: "",
      errorMessage: `Execution service error: ${err.message}`,
      executedAt: new Date(),
      testResults: testCases.map((tc, idx) => ({
        testIndex: tc.testIndex || idx + 1,
        visibility: tc.visibility || "public",
        status: EXECUTION_STATUS.SYSTEM_ERROR,
        passed: false,
        input: tc.input || "",
        expectedOutput: tc.expectedOutput || "",
        actualOutput: "",
        compileOutput: "",
        stderr: err.message,
        durationMs: 0,
        memoryKb: 0,
      })),
    };
  }

  // 3. Persist final results in MongoDB
  try {
    await Submission.findByIdAndUpdate(
      submissionId,
      {
        status: finalLifecycle,
        submissionType,
        executionResult,
      },
      { new: true },
    );
  } catch {
    // Non-fatal in mock test mode
  }

  // 4. Publish real-time event to Redis channel
  const eventPayload = {
    event:
      finalLifecycle === SUBMISSION_LIFECYCLE.COMPLETED
        ? "submission:completed"
        : "submission:failed",
    submissionId: String(submissionId),
    interviewId: String(interviewId),
    questionId: String(questionId),
    status: finalLifecycle,
    submissionType,
    executionResult,
    timestamp: new Date().toISOString(),
  };

  if (publisher && typeof publisher.publish === "function") {
    try {
      await publisher.publish("submission:events", JSON.stringify(eventPayload));
    } catch {
      // Non-fatal if Redis publishing fails
    }
  }

  return {
    submissionId,
    status: finalLifecycle,
    executionResult,
  };
}

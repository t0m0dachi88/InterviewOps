import { Worker } from "bullmq";
import { EXECUTION_STATUS, SUPPORTED_LANGUAGES } from "@platform/shared";
import { workerEnv } from "./config/env.js";
import { QUEUE_NAMES, getBullMQWorkerOptions } from "./config/queue.js";
import { processExecutionJob } from "./processors/execution.processor.js";
import { connectWorkerDb, disconnectWorkerDb } from "./config/db.js";

let isRunning = false;
let heartbeatInterval = null;
let bullmqWorker = null;

export async function startWorker() {
  isRunning = true;

  // eslint-disable-next-line no-console
  console.log("====================================================");
  // eslint-disable-next-line no-console
  console.log("[Worker Service] Code Execution Worker Initialized");
  // eslint-disable-next-line no-console
  console.log(`[Worker Service] Environment: ${workerEnv.NODE_ENV}`);
  // eslint-disable-next-line no-console
  console.log(`[Worker Service] Queue Consumer: ${QUEUE_NAMES.CODE_EXECUTION}`);
  // eslint-disable-next-line no-console
  console.log(`[Worker Service] Concurrency: ${workerEnv.concurrency}`);
  // eslint-disable-next-line no-console
  console.log(
    `[Worker Service] Upstash Redis Status: ${
      workerEnv.redis.isConfigured
        ? "Configured (TLS enabled)"
        : "Pending .env configuration"
    }`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[Worker Service] Judge0 Target URL: ${workerEnv.judge0.url}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[Worker Service] Language Runtimes: ${SUPPORTED_LANGUAGES.join(", ")}`,
  );
  // eslint-disable-next-line no-console
  console.log("====================================================");

  // Connect MongoDB if URI is configured
  if (workerEnv.MONGODB_URI) {
    try {
      await connectWorkerDb();
    } catch {
      // Non-fatal on startup; will retry or log
    }
  }

  const workerOptions = getBullMQWorkerOptions();

  // Initialize BullMQ Worker if Redis is configured
  if (workerEnv.redis.isConfigured && workerEnv.NODE_ENV !== "test") {
    try {
      bullmqWorker = new Worker(
        QUEUE_NAMES.CODE_EXECUTION,
        async (job) => {
          return processExecutionJob(job);
        },
        workerOptions,
      );

      bullmqWorker.on("completed", (job) => {
        // eslint-disable-next-line no-console
        console.log(`[Worker Service] Job ${job.id} completed successfully.`);
      });

      bullmqWorker.on("failed", (job, err) => {
        // eslint-disable-next-line no-console
        console.error(`[Worker Service] Job ${job?.id} failed:`, err.message);
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[Worker Service] Could not bind BullMQ Worker:", err.message);
    }
  }

  // Long-running process heartbeat
  heartbeatInterval = setInterval(() => {
    // Keep alive as standalone background daemon
  }, 1000 * 60);

  return {
    isRunning,
    queue: QUEUE_NAMES.CODE_EXECUTION,
    workerOptions,
    supportedLanguages: SUPPORTED_LANGUAGES,
    executionStatuses: Object.values(EXECUTION_STATUS),
    worker: bullmqWorker,
  };
}

export async function stopWorker() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  if (bullmqWorker) {
    await bullmqWorker.close();
    bullmqWorker = null;
  }
  await disconnectWorkerDb();
  isRunning = false;
  // eslint-disable-next-line no-console
  console.log("[Worker Service] Graceful shutdown completed.");
}

// Graceful termination handling for containerized / standalone deployment
process.on("SIGTERM", async () => {
  // eslint-disable-next-line no-console
  console.log("[Worker Service] SIGTERM received. Shutting down worker...");
  await stopWorker();
  process.exit(0);
});

process.on("SIGINT", async () => {
  // eslint-disable-next-line no-console
  console.log("[Worker Service] SIGINT received. Shutting down worker...");
  await stopWorker();
  process.exit(0);
});

process.on("uncaughtException", async (err) => {
  // eslint-disable-next-line no-console
  console.error("[Worker Service] Uncaught exception:", err.message);
  await stopWorker();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("[Worker Service] Unhandled rejection:", reason);
});

// Start worker service
if (process.env.NODE_ENV !== "test") {
  startWorker();
}

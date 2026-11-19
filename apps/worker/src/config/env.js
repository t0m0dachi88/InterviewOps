import dotenv from "dotenv";

dotenv.config();

export function validateWorkerEnv(envObj = process.env) {
  const NODE_ENV = envObj.NODE_ENV || "development";
  const isProduction = NODE_ENV === "production";

  const WORKER_REDIS_HOST =
    envObj.WORKER_REDIS_HOST || envObj.UPSTASH_REDIS_HOST || "";
  const WORKER_REDIS_PORT = parseInt(
    envObj.WORKER_REDIS_PORT || envObj.UPSTASH_REDIS_PORT || "6379",
    10,
  );
  const WORKER_REDIS_PASSWORD =
    envObj.WORKER_REDIS_PASSWORD || envObj.UPSTASH_REDIS_PASSWORD || "";
  const WORKER_REDIS_TLS =
    envObj.WORKER_REDIS_TLS !== undefined
      ? envObj.WORKER_REDIS_TLS === "true"
      : envObj.UPSTASH_REDIS_TLS !== undefined
        ? envObj.UPSTASH_REDIS_TLS === "true"
        : Boolean(
            WORKER_REDIS_HOST && WORKER_REDIS_HOST.includes("upstash.io"),
          );

  const WORKER_REDIS_URL = envObj.WORKER_REDIS_URL || envObj.REDIS_URL || "";

  const isConfigured = Boolean(
    (WORKER_REDIS_HOST && WORKER_REDIS_PASSWORD) || WORKER_REDIS_URL,
  );
  const concurrency = parseInt(envObj.WORKER_CONCURRENCY || "5", 10);

  // MongoDB Atlas configuration for worker
  const MONGODB_URI = envObj.MONGODB_URI || "";

  // Judge0 Self-Hosted Execution Server configuration
  const JUDGE0_URL = envObj.JUDGE0_URL || "http://localhost:2358";
  const JUDGE0_API_KEY = envObj.JUDGE0_API_KEY || "";
  const JUDGE0_LANG_JS = parseInt(envObj.JUDGE0_LANG_JS || "63", 10);
  const JUDGE0_LANG_PYTHON = parseInt(envObj.JUDGE0_LANG_PYTHON || "71", 10);
  const JUDGE0_LANG_CPP = parseInt(envObj.JUDGE0_LANG_CPP || "54", 10);

  return Object.freeze({
    NODE_ENV,
    isProduction,
    MONGODB_URI,
    judge0: Object.freeze({
      url: JUDGE0_URL,
      apiKey: JUDGE0_API_KEY,
      languages: Object.freeze({
        javascript: JUDGE0_LANG_JS,
        python: JUDGE0_LANG_PYTHON,
        cpp: JUDGE0_LANG_CPP,
      }),
    }),
    redis: Object.freeze({
      host: WORKER_REDIS_HOST,
      port: WORKER_REDIS_PORT,
      password: WORKER_REDIS_PASSWORD,
      tls: WORKER_REDIS_TLS,
      url: WORKER_REDIS_URL,
      isConfigured,
    }),
    concurrency,
  });
}

export const workerEnv = validateWorkerEnv(process.env);

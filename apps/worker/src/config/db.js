import mongoose from "mongoose";
import { workerEnv } from "./env.js";

let isConnected = false;

export async function connectWorkerDb(customUri = null) {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const uri = customUri || workerEnv.MONGODB_URI;
  if (!uri) {
    if (workerEnv.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.warn("[Worker Service] MONGODB_URI not configured. Database operations will fail.");
    }
    return null;
  }

  try {
    await mongoose.connect(uri);
    isConnected = true;
    if (workerEnv.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.log("[Worker Service] Connected to MongoDB Atlas successfully.");
    }
    return mongoose.connection;
  } catch (err) {
    if (workerEnv.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.error("[Worker Service] MongoDB connection error:", err.message);
    }
    throw err;
  }
}

export async function disconnectWorkerDb() {
  if (isConnected || mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
  }
}

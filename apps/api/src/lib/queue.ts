import { Queue } from "bullmq";
import { redis } from "./redis.js";

export interface RenderJobData {
  sessionId: string;
}

export interface SendTelegramJobData {
  sessionId: string;
  telegramUserId: string;
  s3Key: string;
}

export const renderQueue = new Queue<RenderJobData>("render", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export const sendTelegramQueue = new Queue<SendTelegramJobData>("send_to_telegram", {
  connection: redis,
  defaultJobOptions: {
    attempts: 4, // 1 исходная + 3 retry
    backoff: {
      type: "exponential",
      delay: 60000, // 1 минута базовая задержка (1m, 2m, 4m, 8m)
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});


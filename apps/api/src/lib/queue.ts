import { Queue } from "bullmq";
import { redis } from "./redis.js";

export interface RenderJobData {
  sessionId: string;
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


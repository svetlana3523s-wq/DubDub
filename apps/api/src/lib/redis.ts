import * as IORedis from "ioredis";
import { config } from "../config.js";

const Redis = (IORedis as any).default || IORedis;
export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
});


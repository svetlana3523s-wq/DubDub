import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async () => {
    const checks = {
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        database: "unknown",
        redis: "unknown",
      },
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.services.database = "ok";
    } catch {
      checks.services.database = "error";
      checks.status = "degraded";
    }

    try {
      await redis.ping();
      checks.services.redis = "ok";
    } catch {
      checks.services.redis = "error";
      checks.status = "degraded";
    }

    return checks;
  });
};


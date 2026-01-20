import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { getProxyUrl } from "./files.js";
import type { RenderStatusResponse } from "@dubdub/shared";

export const rendersRoutes: FastifyPluginAsync = async (fastify) => {
  // Get render status
  fastify.get<{ Params: { sessionId: string } }>(
    "/renders/:sessionId",
    {
      preHandler: authMiddleware,
      config: {
        rateLimit: {
          max: 1200, // Higher limit for status polling (1200 req/min)
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply): Promise<RenderStatusResponse> => {
      const { sessionId } = request.params;

      const render = await prisma.render.findUnique({
        where: { sessionId },
      });

      if (!render) {
        return reply.status(404).send({ error: "Render not found" });
      }

      // Use proxy URL instead of signed URL
      let videoUrl: string | null = null;
      if (render.status === "ready") {
        videoUrl = getProxyUrl("render", sessionId);
      }

      return {
        status: render.status as any,
        videoUrl,
      };
    }
  );
};


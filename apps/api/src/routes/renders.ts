import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { storage } from "../lib/storage.js";
import { authMiddleware } from "../middleware/auth.js";
import type { RenderStatusResponse } from "@dubdub/shared";

export const rendersRoutes: FastifyPluginAsync = async (fastify) => {
  // Get render status
  fastify.get<{ Params: { sessionId: string } }>(
    "/renders/:sessionId",
    { preHandler: authMiddleware },
    async (request, reply): Promise<RenderStatusResponse> => {
      const { sessionId } = request.params;

      const render = await prisma.render.findUnique({
        where: { sessionId },
      });

      if (!render) {
        return reply.status(404).send({ error: "Render not found" });
      }

      let videoUrl: string | null = null;
      if (render.status === "ready" && render.s3Key) {
        try {
          videoUrl = await storage.getSignedUrl(render.s3Key, 7200); // 2 hours
        } catch (err) {
          console.error("Failed to get signed URL:", err);
        }
      }

      return {
        status: render.status as any,
        videoUrl,
      };
    }
  );
};


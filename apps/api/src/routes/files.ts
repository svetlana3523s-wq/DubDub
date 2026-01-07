import type { FastifyPluginAsync } from "fastify";
import { storage } from "../lib/storage.js";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { authMiddleware } from "../middleware/auth.js";
import { bot } from "../lib/bot-instance.js";

/**
 * File proxy routes - serves files from S3 through the API
 * Uses streaming for efficient delivery
 */
export const filesRoutes: FastifyPluginAsync = async (fastify) => {
  // Serve scene videos (streaming)
  fastify.get<{ Params: { filename: string } }>(
    "/files/scenes/:filename",
    async (request, reply) => {
      const { filename } = request.params;
      const key = `scenes/${filename}`;

      try {
        const { stream, contentLength } = await storage.getStream(key);
        
        reply
          .header("Content-Type", "video/mp4")
          .header("Cache-Control", "public, max-age=86400")
          .header("Accept-Ranges", "bytes");
        
        if (contentLength) {
          reply.header("Content-Length", contentLength);
        }
        
        return reply.send(stream);
      } catch (err: any) {
        if (err.name === "NoSuchKey") {
          return reply.status(404).send({ error: "File not found" });
        }
        console.error("File stream error:", err);
        return reply.status(500).send({ error: "Failed to load file" });
      }
    }
  );

  // Serve rendered videos (streaming)
  fastify.get<{ Params: { sessionId: string } }>(
    "/files/renders/:sessionId",
    async (request, reply) => {
      const { sessionId } = request.params;
      const key = `renders/${sessionId}.mp4`;

      try {
        const { stream, contentLength } = await storage.getStream(key);
        
        reply
          .header("Content-Type", "video/mp4")
          .header("Cache-Control", "public, max-age=86400")
          .header("Accept-Ranges", "bytes");
        
        if (contentLength) {
          reply.header("Content-Length", contentLength);
        }
        
        return reply.send(stream);
      } catch (err: any) {
        if (err.name === "NoSuchKey") {
          return reply.status(404).send({ error: "Render not found" });
        }
        console.error("Render stream error:", err);
        return reply.status(500).send({ error: "Failed to load render" });
      }
    }
  );

  // Serve audio previews (streaming)
  fastify.get<{ Params: { sessionId: string; roleIndex: string } }>(
    "/files/previews/:sessionId/:roleIndex",
    async (request, reply) => {
      const { sessionId, roleIndex } = request.params;
      const key = `previews/${sessionId}/preview_for_${roleIndex}.webm`;

      try {
        const { stream, contentLength } = await storage.getStream(key);
        
        reply
          .header("Content-Type", "audio/webm")
          .header("Cache-Control", "public, max-age=3600");
        
        if (contentLength) {
          reply.header("Content-Length", contentLength);
        }
        
        return reply.send(stream);
      } catch (err: any) {
        if (err.name === "NoSuchKey") {
          return reply.status(404).send({ error: "Preview not found" });
        }
        console.error("Preview stream error:", err);
        return reply.status(500).send({ error: "Failed to load preview" });
      }
    }
  );

  // Send video to user via Telegram bot
  fastify.post<{ Params: { sessionId: string } }>(
    "/files/renders/:sessionId/send-to-telegram",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { sessionId } = request.params;
      const user = request.tgUser;

      try {
        // Check render exists and is ready
        const render = await prisma.render.findUnique({
          where: { sessionId },
          include: { session: true },
        });

        if (!render || render.status !== "ready" || !render.s3Key) {
          return reply.status(404).send({ error: "Render not ready" });
        }

        // Download video from S3
        const videoBuffer = await storage.download(render.s3Key);

        // Send video via Telegram
        await bot.telegram.sendVideo(
          user.id,
          { source: videoBuffer, filename: `dubdub-${sessionId}.mp4` },
          {
            caption: `🎬 Ваш дубляж "${render.session.topic}"\n\nСоздано в @${config.botUsername}`,
            supports_streaming: true,
          }
        );

        return { sent: true };
      } catch (err) {
        console.error("Send to Telegram error:", err);
        return reply.status(500).send({ error: "Failed to send video" });
      }
    }
  );
};

/**
 * Helper to generate proxy URLs instead of signed S3 URLs
 */
export function getProxyUrl(type: "scene" | "render" | "preview", ...args: string[]): string {
  const baseUrl = config.apiBaseUrl;
  
  switch (type) {
    case "scene":
      return `${baseUrl}/files/scenes/${args[0]}`;
    case "render":
      return `${baseUrl}/files/renders/${args[0]}.mp4`;
    case "preview":
      return `${baseUrl}/files/previews/${args[0]}/${args[1]}`;
    default:
      throw new Error(`Unknown file type: ${type}`);
  }
}


import type { FastifyPluginAsync } from "fastify";
import { storage } from "../lib/storage.js";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { authMiddleware } from "../middleware/auth.js";
import { bot } from "../lib/bot-instance.js";
import { sendTelegramQueue } from "../lib/queue.js";

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
  // URL format: /files/renders/:sessionId.mp4 (sessionId param includes .mp4)
  // Supports ?t=timestamp query param for cache-busting
  fastify.get<{ Params: { sessionId: string }; Querystring: { t?: string } }>(
    "/files/renders/:sessionId",
    async (request, reply) => {
      // Strip .mp4 extension if present (URL is /files/renders/abc123.mp4)
      const rawSessionId = request.params.sessionId;
      const sessionId = rawSessionId.endsWith('.mp4') ? rawSessionId.slice(0, -4) : rawSessionId;
      const key = `renders/${sessionId}.mp4`;

      try {
        const { stream, contentLength } = await storage.getStream(key);
        
        reply
          .header("Content-Type", "video/mp4")
          // No caching for renders - they can be re-rendered with same sessionId
          .header("Cache-Control", "no-cache, no-store, must-revalidate")
          .header("Pragma", "no-cache")
          .header("Expires", "0")
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

  // Send video to user via Telegram bot (queued job)
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
          return reply.status(404).send({ status: "error", error: "Видео ещё не готово" });
        }

        // Check if already queued or sending
        if (render.sendStatus === "queued" || render.sendStatus === "sending") {
          return reply.code(200).send({ 
            status: render.sendStatus, 
            message: "Отправка уже в процессе" 
          });
        }

        // Check if already sent
        if (render.sendStatus === "sent") {
          return reply.code(200).send({ 
            status: "sent", 
            message: "Видео уже отправлено" 
          });
        }

        // Queue send job
        const job = await sendTelegramQueue.add("send", {
          sessionId,
          telegramUserId: user.id,
          s3Key: render.s3Key,
        });

        // Update render status
        await prisma.render.update({
          where: { sessionId },
          data: { 
            sendStatus: "queued",
            sendError: null,
            sendAttempts: 0,
          },
        });

        console.log(`[SendVideo] Queued send job ${job.id} for session ${sessionId}, user ${user.id}`);
        
        return reply.code(200).send({ 
          status: "queued", 
          jobId: job.id,
          message: "Отправка поставлена в очередь" 
        });
      } catch (err: any) {
        console.error("[SendVideo] Unexpected error:", err);
        return reply.code(500).send({ status: "error", error: "Ошибка при постановке в очередь" });
      }
    }
  );

  // Get send status
  fastify.get<{ Params: { sessionId: string } }>(
    "/files/renders/:sessionId/send-status",
    {
      preHandler: authMiddleware,
      config: {
        rateLimit: {
          max: 600, // Higher limit for status polling (600 req/min)
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params;
      const user = request.tgUser;

      try {
        const render = await prisma.render.findUnique({
          where: { sessionId },
        });

        if (!render) {
          return reply.status(404).send({ error: "Render not found" });
        }

        // Check if user is participant (security)
        const session = await prisma.session.findUnique({
          where: { id: sessionId },
          include: { participants: true },
        });

        if (!session) {
          return reply.status(404).send({ error: "Session not found" });
        }

        const isParticipant = session.participants.some(p => p.tgUserId === user.id);
        if (!isParticipant) {
          return reply.status(403).send({ error: "Not a participant" });
        }

        return reply.code(200).send({
          status: render.sendStatus || null,
          error: render.sendError || null,
          attempts: render.sendAttempts || 0,
        });
      } catch (err: any) {
        console.error("[SendStatus] Unexpected error:", err);
        return reply.code(500).send({ error: "Ошибка при получении статуса" });
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


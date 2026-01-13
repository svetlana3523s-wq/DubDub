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

  // Send video to user via Telegram bot (using URL for faster delivery, like channel)
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
          console.error(`[SendVideo] Render not ready for session ${sessionId}`);
          return reply.code(400).send({ sent: false, error: "Видео ещё не готово" });
        }

        console.log(`[SendVideo] Sending video via URL to ${user.id}`);
        
        // Use URL instead of Buffer for faster delivery
        const videoUrl = `${config.apiBaseUrl}/files/renders/${sessionId}.mp4`;
        const chatId = parseInt(user.id, 10);
        
        let sent = false;
        try {
          await bot.telegram.sendVideo(
            chatId,
            { url: videoUrl },
            {
              caption: `🎬 Ваш дубляж ${render.session.task ? `"${render.session.task}"` : ""}\n\nСоздано в @${config.botUsername}`,
              supports_streaming: true,
              reply_markup: {
                keyboard: [
                  [{ text: "🎭 Начать игру" }],
                  [{ text: "👥 Присоединиться к игре" }],
                  [{ text: "💡 Предложить эпизод" }],
                ],
                resize_keyboard: true,
                is_persistent: true,
              },
            }
          );
          sent = true;
          console.log(`[SendVideo] Successfully sent video to ${chatId} via URL`);
        } catch (sendErr: any) {
          console.error(`[SendVideo] Failed to send via URL:`, sendErr.message || sendErr);
          // Fallback: try with Buffer if URL method fails
          console.log(`[SendVideo] Falling back to Buffer method...`);
          try {
            const videoBuffer = await storage.download(render.s3Key);
            await bot.telegram.sendVideo(
              chatId,
              { source: videoBuffer, filename: `dubdub-${sessionId}.mp4` },
              {
                caption: `🎬 Ваш дубляж ${render.session.task ? `"${render.session.task}"` : ""}\n\nСоздано в @${config.botUsername}`,
                supports_streaming: true,
                reply_markup: {
                  keyboard: [
                    [{ text: "🎭 Начать игру" }],
                    [{ text: "👥 Присоединиться к игре" }],
                    [{ text: "💡 Предложить эпизод" }],
                  ],
                  resize_keyboard: true,
                  is_persistent: true,
                },
              }
            );
            sent = true;
            console.log(`[SendVideo] Successfully sent video to ${chatId} via Buffer fallback`);
          } catch (bufferErr: any) {
            console.error(`[SendVideo] Buffer fallback also failed:`, bufferErr.message || bufferErr);
          }
        }

        if (sent) {
          return reply.code(200).send({ sent: true });
        } else {
          return reply.code(500).send({ sent: false, error: "Не удалось отправить видео" });
        }
      } catch (err: any) {
        console.error("[SendVideo] Unexpected error:", err);
        return reply.code(500).send({ sent: false, error: "Ошибка при отправке" });
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


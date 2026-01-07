import type { FastifyPluginAsync } from "fastify";
import { storage } from "../lib/storage.js";
import { config } from "../config.js";

/**
 * File proxy routes - serves files from S3 through the API
 * This avoids CORS issues and keeps MinIO internal
 */
export const filesRoutes: FastifyPluginAsync = async (fastify) => {
  // Serve scene videos
  fastify.get<{ Params: { filename: string } }>(
    "/files/scenes/:filename",
    async (request, reply) => {
      const { filename } = request.params;
      const key = `scenes/${filename}`;

      try {
        const buffer = await storage.download(key);
        return reply
          .header("Content-Type", "video/mp4")
          .header("Cache-Control", "public, max-age=86400")
          .send(buffer);
      } catch (err: any) {
        if (err.name === "NoSuchKey") {
          return reply.status(404).send({ error: "File not found" });
        }
        console.error("File download error:", err);
        return reply.status(500).send({ error: "Failed to load file" });
      }
    }
  );

  // Serve rendered videos
  fastify.get<{ Params: { sessionId: string } }>(
    "/files/renders/:sessionId",
    async (request, reply) => {
      const { sessionId } = request.params;
      const key = `renders/${sessionId}.mp4`;

      try {
        const buffer = await storage.download(key);
        return reply
          .header("Content-Type", "video/mp4")
          .header("Cache-Control", "public, max-age=86400")
          .send(buffer);
      } catch (err: any) {
        if (err.name === "NoSuchKey") {
          return reply.status(404).send({ error: "Render not found" });
        }
        console.error("Render download error:", err);
        return reply.status(500).send({ error: "Failed to load render" });
      }
    }
  );

  // Serve audio previews
  fastify.get<{ Params: { sessionId: string; roleIndex: string } }>(
    "/files/previews/:sessionId/:roleIndex",
    async (request, reply) => {
      const { sessionId, roleIndex } = request.params;
      const key = `previews/${sessionId}/preview_for_${roleIndex}.webm`;

      try {
        const buffer = await storage.download(key);
        return reply
          .header("Content-Type", "audio/webm")
          .header("Cache-Control", "public, max-age=3600")
          .send(buffer);
      } catch (err: any) {
        if (err.name === "NoSuchKey") {
          return reply.status(404).send({ error: "Preview not found" });
        }
        console.error("Preview download error:", err);
        return reply.status(500).send({ error: "Failed to load preview" });
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
      return `${baseUrl}/files/renders/${args[0]}`;
    case "preview":
      return `${baseUrl}/files/previews/${args[0]}/${args[1]}`;
    default:
      throw new Error(`Unknown file type: ${type}`);
  }
}


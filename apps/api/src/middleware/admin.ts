import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";

export async function adminMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // This middleware should be used after authMiddleware
  // which sets request.tgUser
  const tgUser = (request as any).tgUser;

  if (!tgUser) {
    return reply.status(401).send({
      error: "Authentication required",
      code: "UNAUTHORIZED",
    });
  }

  const userId = String(tgUser.id);
  const isAdmin = config.adminTgUserIds.includes(userId);

  if (!isAdmin) {
    return reply.status(403).send({
      error: "Admin access required",
      code: "FORBIDDEN",
    });
  }
}


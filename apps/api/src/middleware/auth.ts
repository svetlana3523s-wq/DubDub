import type { FastifyRequest, FastifyReply } from "fastify";
import { validateInitData } from "../lib/telegram-auth.js";
import { config } from "../config.js";
import type { TelegramUser } from "@dubdub/shared";

declare module "fastify" {
  interface FastifyRequest {
    tgUser: TelegramUser;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const initData = request.headers["x-tg-init-data"];

  if (!initData || typeof initData !== "string") {
    return reply.status(401).send({
      error: "Missing X-TG-INIT-DATA header",
      code: "UNAUTHORIZED",
    });
  }

  const result = validateInitData(initData, config.botToken);

  if (!result.valid) {
    return reply.status(401).send({
      error: `Invalid initData: ${result.error}`,
      code: "UNAUTHORIZED",
    });
  }

  request.tgUser = result.user;
}


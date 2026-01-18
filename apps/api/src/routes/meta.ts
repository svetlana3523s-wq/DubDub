import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";

export const metaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/meta/version", async () => {
    const minWebBuildId = config.minWebBuildId || null;

    if (!minWebBuildId) {
      return {
        minWebBuildId: null,
        recommendedAction: "refresh",
        messageRu: "\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0432\u0435\u0440\u0441\u0438\u0438 \u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u0430",
      };
    }

    return {
      minWebBuildId,
      recommendedAction: "refresh",
      messageRu: "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044f \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u044f",
    };
  });
};

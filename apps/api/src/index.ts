import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { redis } from "./lib/redis.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { rendersRoutes } from "./routes/renders.js";
import { healthRoutes } from "./routes/health.js";
import { adminRoutes } from "./routes/admin.js";
import { createBot } from "./bot.js";

const fastify = Fastify({
  logger: {
    level: "info",
  },
});

// CORS
await fastify.register(cors, {
  origin: [config.webappUrl],
  credentials: true,
});

// Multipart for file uploads
await fastify.register(multipart, {
  limits: {
    fileSize: config.maxAudioSizeMb * 1024 * 1024,
    files: 1,
  },
});

// Rate limiting
await fastify.register(rateLimit, {
  global: true,
  max: 100,
  timeWindow: "1 minute",
  redis,
});

// Routes
await fastify.register(healthRoutes);
await fastify.register(sessionsRoutes);
await fastify.register(rendersRoutes);
await fastify.register(adminRoutes);

// Start bot
const bot = createBot();

// Use webhook in production or polling in development
const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  // Webhook mode for production
  const webhookPath = `/bot${config.botToken}`;

  fastify.post(webhookPath, async (request, reply) => {
    await bot.handleUpdate(request.body as any);
    return reply.send({ ok: true });
  });

  // Set webhook after server starts
  fastify.addHook("onReady", async () => {
    const webhookUrl = `${config.apiBaseUrl}${webhookPath}`;
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`Bot webhook set to: ${webhookUrl}`);
  });
} else {
  // Polling mode for development
  bot.launch().then(() => {
    console.log("Bot started in polling mode");
  });
}

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down...`);
  bot.stop(signal);
  await fastify.close();
  process.exit(0);
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Start server
try {
  await fastify.listen({ port: config.port, host: config.host });
  console.log(`API server running on http://localhost:${config.port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

export { bot };


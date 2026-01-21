import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { redis } from "./lib/redis.js";
import { prisma } from "./lib/prisma.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { rendersRoutes } from "./routes/renders.js";
import { healthRoutes } from "./routes/health.js";
import { adminRoutes } from "./routes/admin.js";
import { filesRoutes } from "./routes/files.js";
import { metaRoutes } from "./routes/meta.js";
import { bot } from "./lib/bot-instance.js";

const fastify = Fastify({
  logger: {
    level: "info",
  },
  trustProxy: true,
  bodyLimit: 500 * 1024 * 1024, // 500 MB for video uploads
  requestTimeout: 600000, // 10 minutes for large file uploads
  connectionTimeout: 600000, // 10 minutes
});

// CORS - allow all origins for Telegram WebApp
await fastify.register(cors, {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-TG-INIT-DATA"],
  exposedHeaders: ["Retry-After"],
  maxAge: 600,
});

fastify.options("*", async (_request, reply) => {
  return reply.code(204).send();
});

// Multipart for file uploads
await fastify.register(multipart, {
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB for video uploads
    files: 1,
    fields: 10, // Max number of form fields
  },
});

// Rate limiting - global limit for all endpoints
await fastify.register(rateLimit, {
  global: true,
  max: 200, // 200 requests per minute for general endpoints
  timeWindow: "1 minute",
  redis,
});

// Routes
await fastify.register(healthRoutes);
await fastify.register(sessionsRoutes);
await fastify.register(rendersRoutes);
await fastify.register(adminRoutes);
await fastify.register(filesRoutes);
await fastify.register(metaRoutes);

// Use webhook in production or polling in development
const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  // Webhook mode for production
  const webhookPath = `/bot${config.botToken}`;

  fastify.post(webhookPath, async (request, reply) => {
    // Reply immediately to Telegram to prevent timeout
    reply.send({ ok: true });
    
    // Process update asynchronously
    bot.handleUpdate(request.body as any).catch((err) => {
      console.error("Webhook update processing error:", err);
    });
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

// Stats notification to channel (2 times a day)
async function sendDailyStats() {
  if (!config.notifyChannelId) return;
  
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const [totalUsers, totalSessions, todaySessions, todayUsers, completedVideos] = await Promise.all([
      prisma.participant.groupBy({ by: ["tgUserId"] }).then(r => r.length),
      prisma.session.count(),
      prisma.session.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.participant.groupBy({ 
        by: ["tgUserId"],
        where: { joinedAt: { gte: todayStart } }
      }).then(r => r.length),
      prisma.render.count({ where: { status: "ready" } }),
    ]);
    
    const now = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
    
    await bot.telegram.sendMessage(
      config.notifyChannelId,
      `📊 Статистика на ${now}\n\n` +
      `👥 Всего игроков: ${totalUsers}\n` +
      `🆕 Новых сегодня: ${todayUsers}\n` +
      `🎬 Записано видео: ${completedVideos}\n` +
      `📅 Сессий сегодня: ${todaySessions}\n` +
      `📈 Всего сессий: ${totalSessions}`
    );
    console.log("Daily stats sent to channel");
  } catch (err) {
    console.error("Failed to send daily stats:", err);
  }
}

// Schedule stats at 10:00 and 22:00 Moscow time
function scheduleStats() {
  const checkAndSend = () => {
    const now = new Date();
    const moscowHour = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" })).getHours();
    const minutes = now.getMinutes();
    
    // Send at 10:00 and 22:00 (check every hour at minute 0-5)
    if ((moscowHour === 10 || moscowHour === 22) && minutes < 5) {
      sendDailyStats();
    }
  };
  
  // Check every hour
  setInterval(checkAndSend, 60 * 60 * 1000);
  console.log("Stats scheduler started");
}

if (config.notifyChannelId) {
  scheduleStats();
}


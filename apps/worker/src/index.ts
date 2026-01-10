import { Worker, Job } from "bullmq";
import * as IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { Telegraf } from "telegraf";
import { createServer } from "http";
import { renderVideo } from "./render.js";
import { config } from "./config.js";
import type { Cue } from "@dubdub/shared";
import { parseCuesFromJson } from "@dubdub/shared";

const prisma = new PrismaClient();
const bot = new Telegraf(config.botToken);

const Redis = (IORedis as any).default || IORedis;
const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

interface RenderJobData {
  sessionId: string;
}

async function processRenderJob(job: Job<RenderJobData>): Promise<void> {
  const { sessionId } = job.data;
  console.log(`[${sessionId}] Starting render job`);

  try {
    // Update status
    await prisma.render.update({
      where: { sessionId },
      data: { status: "rendering" },
    });

    // Get session data
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        scene: true,
        takes: { orderBy: { roleIndex: "asc" } },
        participants: { orderBy: { roleIndex: "asc" } },
      },
    });

    if (!session) {
      throw new Error("Session not found");
    }

    // Parse cues and convert from frames to seconds if needed
    const fps = session.scene.fps;
    const cues: Cue[] = parseCuesFromJson(session.scene.cueJson, fps);

    console.log(`[${sessionId}] Parsed ${cues.length} cues, FPS: ${fps}`);

    // Build takes data with participant info
    const takesData = session.takes.map((take) => {
      const participant = session.participants.find(
        (p) => p.roleIndex === take.roleIndex
      );
      return {
        roleIndex: take.roleIndex,
        s3Key: take.s3Key,
        displayName: participant?.displayName || `Player ${take.roleIndex + 1}`,
      };
    });

    // Render video
    const s3Key = await renderVideo({
      sessionId,
      sceneS3Key: session.scene.s3Key,
      takes: takesData,
      cues,
      sceneDuration: session.scene.durationSec,
    });

    // Update records
    await prisma.render.update({
      where: { sessionId },
      data: { status: "ready", s3Key },
    });

    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "ready" },
    });

    console.log(`[${sessionId}] Render completed successfully`);

    // Send video to notify channel
    if (config.notifyChannelId) {
      try {
        const videoUrl = `${config.apiBaseUrl}/files/renders/${sessionId}.mp4`;
        const categoryLabel = session.category === "movies" ? "🎬 Кино" : 
                              session.category === "memes" ? "😂 Мемы" : "🏛️ Политика";
        const modeLabel = session.gameMode === "tasks" ? `📝 ${session.task}` : "🎭 Импровизация";
        const players = session.participants.map(p => p.displayName).join(", ");
        
        await bot.telegram.sendVideo(
          config.notifyChannelId,
          { url: videoUrl },
          {
            caption: `🎬 Новый дубляж!\n\n${categoryLabel} • ${modeLabel}\n👥 ${players}`,
            supports_streaming: true,
          }
        );
        console.log(`[${sessionId}] Sent to notify channel`);
      } catch (err) {
        console.error(`[${sessionId}] Failed to send to channel:`, err);
      }
    }
  } catch (err) {
    console.error(`[${sessionId}] Render failed:`, err);

    await prisma.render.update({
      where: { sessionId },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      },
    });

    throw err;
  }
}

const worker = new Worker<RenderJobData>("render", processRenderJob, {
  connection: redis,
  concurrency: 2,
});

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed for session ${job.data.sessionId}`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("Worker error:", err);
});

// Graceful shutdown
const shutdown = async () => {
  console.log("Shutting down worker...");
  await worker.close();
  await redis.quit();
  await prisma.$disconnect();
  // Health server will be closed when process exits
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Worker started, listening for render jobs...");

// Health check HTTP server
const healthPort = parseInt(process.env.WORKER_HEALTH_PORT || "3002");
const healthServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      status: "ok", 
      service: "dubdub-worker",
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

healthServer.listen(healthPort, () => {
  console.log(`Health check server listening on port ${healthPort}`);
});


import { Worker, Job, Queue } from "bullmq";
import * as IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { Telegraf } from "telegraf";
import { createServer } from "http";
import { renderVideo } from "./render.js";
import { sendVideoToTelegram, type SendTelegramInput, RateLimitError } from "./send-telegram.js";
import { config } from "./config.js";
import type { Cue } from "@dubdub/shared";
import { parseCuesFromJson } from "@dubdub/shared";

const prisma = new PrismaClient();
const bot = new Telegraf(config.botToken);

const Redis = (IORedis as any).default || IORedis;
const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

const sendTelegramQueue = new Queue<SendTelegramJobData>("send_to_telegram", {
  connection: redis,
  defaultJobOptions: {
    attempts: 4,
    backoff: {
      type: "exponential",
      delay: 60000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

interface RenderJobData {
  sessionId: string;
}

interface SendTelegramJobData {
  sessionId: string;
  telegramUserId: string;
  s3Key: string;
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
    const takesData = session.takes.map((take: (typeof session.takes)[number]) => {
      const participant = session.participants.find(
        (p: (typeof session.participants)[number]) => p.roleIndex === take.roleIndex
      );
      return {
        roleIndex: take.roleIndex,
        s3Key: take.s3Key,
        displayName: participant?.displayName || `Player ${take.roleIndex + 1}`,
      };
    });

    // Render video with retry on timeout (up to 2 retries)
    const maxRetries = 2;
    let retryCount = 0;
    let s3Key: string | null = null;
    
    while (!s3Key && retryCount <= maxRetries) {
      try {
        s3Key = await renderVideo({
          sessionId,
          sceneS3Key: session.scene.s3Key,
          takes: takesData,
          cues,
          sceneDuration: session.scene.durationSec,
        });
        console.log(`[${sessionId}] Render succeeded on attempt ${retryCount + 1}`);
      } catch (renderErr: any) {
        const isTimeout = renderErr.message?.includes("timeout") || renderErr.message?.includes("FFmpeg timeout");
        
        if (isTimeout && retryCount < maxRetries) {
          retryCount++;
          const waitTime = retryCount * 5000; // 5s, 10s
          console.log(`[${sessionId}] Render timeout on attempt ${retryCount}, retrying in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        // Not a timeout or max retries reached - throw error
        throw renderErr;
      }
    }

    if (!s3Key) {
      throw new Error("Render failed after retries");
    }

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

    const renderRecord = await prisma.render.findUnique({
      where: { sessionId },
    });

    if (renderRecord?.s3Key) {
      for (const participant of session.participants) {
        const existingRenderSend = await prisma.renderSend.findUnique({
          where: {
            renderId_telegramUserId: {
              renderId: renderRecord.id,
              telegramUserId: participant.tgUserId,
            },
          },
        });

        if (existingRenderSend) {
          console.log(
            `[${sessionId}] Auto-send skipped for user ${participant.tgUserId} (status=${existingRenderSend.status})`
          );
          continue;
        }

        const jobId = `send:${renderRecord.id}:${participant.tgUserId}`;
        const existingJob = await sendTelegramQueue.getJob(jobId);
        if (existingJob) {
          console.log(`[${sessionId}] Auto-send job already exists: ${jobId}`);
          continue;
        }

        await prisma.renderSend.upsert({
          where: {
            renderId_telegramUserId: {
              renderId: renderRecord.id,
              telegramUserId: participant.tgUserId,
            },
          },
          update: {
            status: "queued",
            error: null,
            attempts: 0,
            retryAfterSeconds: null,
          },
          create: {
            renderId: renderRecord.id,
            telegramUserId: participant.tgUserId,
            status: "queued",
            attempts: 0,
          },
        });

        await sendTelegramQueue.add(
          jobId,
          {
            sessionId,
            telegramUserId: participant.tgUserId,
            s3Key: renderRecord.s3Key,
          },
          { jobId }
        );

        console.log(`[${sessionId}] Auto-send queued for user ${participant.tgUserId}`);
      }
    } else {
      console.error(`[${sessionId}] Auto-send skipped: render record or s3Key missing`);
    }

    // Send text-only notification to admin channel
    if (config.notifyChannelId) {
      try {
        const categoryLabel =
          session.category === "movies"
            ? "\u0424\u0438\u043b\u044c\u043c\u044b"
            : session.category === "memes"
              ? "\u041c\u0435\u043c\u044b"
              : "\u041f\u043e\u043b\u0438\u0442\u0438\u043a\u0430";
        const modeLabel =
          session.gameMode === "tasks"
            ? `\u0417\u0430\u0434\u0430\u043d\u0438\u0435: ${session.task}`
            : "\u0420\u0435\u0436\u0438\u043c: \u0438\u043c\u043f\u0440\u043e\u0432\u0438\u0437\u0430\u0446\u0438\u044f";
        const players = session.participants.map((p: (typeof session.participants)[number]) => p.displayName).join(", ");
        const resultUrl = `https://app.tvotototo.ru/s/${sessionId}/result`;
        const fileUrl = `https://tvotototo.ru/files/renders/${sessionId}.mp4`;
        const message = [
          "\u0418\u0433\u0440\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430",
          "",
          `\u0421\u0435\u0441\u0441\u0438\u044f: ${sessionId}`,
          `\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f: ${categoryLabel}`,
          modeLabel,
          `\u0418\u0433\u0440\u043e\u043a\u0438: ${players || "\u2014"}`,
          "",
          `\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442: ${resultUrl}`,
          `MP4: ${fileUrl}`,
        ].join("\n");

        await bot.telegram.sendMessage(config.notifyChannelId, message);
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

// Process send-to-telegram jobs
async function processSendTelegramJob(job: Job<SendTelegramJobData>): Promise<void> {
  const { sessionId, telegramUserId, s3Key } = job.data;
  const jobStartTime = Date.now();
  const jobEnqueuedAt = job.timestamp || Date.now();
  const timeSinceEnqueue = jobStartTime - jobEnqueuedAt;
  
  console.log(`[SendTelegram:${sessionId}] Processing send job (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);
  console.log(`[SendTelegram:${sessionId}] [${timeSinceEnqueue}ms] Time from enqueue to start processing`);
  
  try {
    await sendVideoToTelegram({ sessionId, telegramUserId, s3Key });
    const totalJobTime = Date.now() - jobStartTime;
    console.log(`[SendTelegram:${sessionId}] [${totalJobTime}ms] Job completed successfully`);
  } catch (err: any) {
    // Handle rate limit errors: delay job instead of retrying immediately
    if (err instanceof RateLimitError) {
      const delayMs = err.retryAfter * 1000; // Convert seconds to milliseconds
      const delayTimestamp = Date.now() + delayMs;
      console.log(`[SendTelegram:${sessionId}] Rate limited, delaying job for ${err.retryAfter}s (until ${new Date(delayTimestamp).toISOString()})`);
      await job.moveToDelayed(delayTimestamp);
      console.log(`[SendTelegram:${sessionId}] Job moved to delayed queue, will retry at ${new Date(delayTimestamp).toISOString()}`);
      return; // Don't throw error - job will be retried after delay
    }
    
    const totalJobTime = Date.now() - jobStartTime;
    console.error(`[SendTelegram:${sessionId}] [${totalJobTime}ms] Job failed:`, err.message);
    // Re-throw other errors for BullMQ retry mechanism
    throw err;
  }
}

const renderWorker = new Worker<RenderJobData>("render", processRenderJob, {
  connection: redis,
  concurrency: 2,
});

const sendTelegramWorker = new Worker<SendTelegramJobData>("send_to_telegram", processSendTelegramJob, {
  connection: redis,
  concurrency: 3, // Can send multiple videos in parallel
});

renderWorker.on("completed", (job) => {
  console.log(`[Render] Job ${job.id} completed for session ${job.data.sessionId}`);
});

renderWorker.on("failed", (job, err) => {
  console.error(`[Render] Job ${job?.id} failed:`, err.message);
});

renderWorker.on("error", (err) => {
  console.error("[Render] Worker error:", err);
});

sendTelegramWorker.on("completed", (job) => {
  console.log(`[SendTelegram] Job ${job.id} completed for session ${job.data.sessionId}`);
});

sendTelegramWorker.on("failed", (job, err) => {
  console.error(`[SendTelegram] Job ${job?.id} failed (attempts: ${job?.attemptsMade}):`, err.message);
});

sendTelegramWorker.on("error", (err) => {
  console.error("[SendTelegram] Worker error:", err);
});

// Graceful shutdown
const shutdown = async () => {
  console.log("Shutting down workers...");
  await renderWorker.close();
  await sendTelegramWorker.close();
  await redis.quit();
  await prisma.$disconnect();
  // Health server will be closed when process exits
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Worker started, listening for render and send-telegram jobs...");

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


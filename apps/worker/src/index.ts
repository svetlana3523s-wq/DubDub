import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { renderVideo } from "./render.js";
import { config } from "./config.js";
import type { Cue } from "@dubdub/shared";

const prisma = new PrismaClient();

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

    const cues: Cue[] = JSON.parse(session.scene.cueJson);

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
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Worker started, listening for render jobs...");


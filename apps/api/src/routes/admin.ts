import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { renderQueue } from "../lib/queue.js";
import { config } from "../config.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminMiddleware } from "../middleware/admin.js";
import { storage } from "../lib/storage.js";
import { getProxyUrl } from "./files.js";
import { spawn } from "child_process";
import { writeFile, unlink, mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import { parseCuesFromJson, cuesToFrames, validateCues, type Cue } from "@dubdub/shared";
import type { SceneListItem, SceneDetail, ScenesListResponse } from "@dubdub/shared";

// Helper function to create video with audio cut at specified ranges using FFmpeg
async function createCutsVideo(
  inputPath: string,
  outputPath: string,
  cues: Cue[],
  duration: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (cues.length === 0) {
      // No cues - just copy the file
      import("fs").then((fs) => {
        fs.copyFile(inputPath, outputPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return;
    }

    // Build volume filter to mute audio during cue ranges
    // Format: volume=enable='between(t,start,end)':volume=0
    const volumeFilters = cues.map((cue) => {
      const start = cue.startSec.toFixed(3);
      const end = (cue.startSec + cue.durationSec).toFixed(3);
      return `volume=enable='between(t,${start},${end})':volume=0`;
    });

    // Chain all volume filters together
    const audioFilter = volumeFilters.join(",");

    const ffmpeg = spawn("ffmpeg", [
      "-i", inputPath,
      "-af", audioFilter,
      "-c:v", "copy", // Copy video stream without re-encoding
      "-y", // Overwrite output
      outputPath,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        console.error(`[Admin] FFmpeg failed with code ${code}:`, stderr);
        reject(new Error(`FFmpeg failed: ${stderr.slice(-500)}`));
      }
    });

    ffmpeg.on("error", (err) => {
      console.error(`[Admin] FFmpeg spawn error:`, err);
      reject(new Error(`Failed to run FFmpeg: ${err.message}`));
    });
  });
}

// Helper function to get video info using ffprobe
async function getVideoInfo(filePath: string): Promise<{ duration: number; fps: number }> {
  return new Promise((resolve, reject) => {
    import("fs").then((fs) => {
      fs.stat(filePath, (statErr, stats) => {
        if (statErr || !stats || stats.size === 0) {
          reject(new Error(`File not found or empty: ${filePath}`));
          return;
        }

        const ffprobe = spawn("ffprobe", [
          "-v", "error",
          "-select_streams", "v:0",
          "-show_entries", "stream=r_frame_rate,width,height,codec_name:format=duration,format_name",
          "-of", "json",
          filePath,
        ]);

        let stdout = "";
        let stderr = "";

        ffprobe.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        ffprobe.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        ffprobe.on("close", (code) => {
          if (code === 0) {
            try {
              const json = JSON.parse(stdout);
              const stream = json.streams?.[0];
              const format = json.format;

              if (!stream || !format) {
                console.error(`[Admin] Invalid ffprobe output:`, json);
                reject(new Error("Invalid ffprobe output: missing stream or format. File may not be a valid video."));
                return;
              }

              const duration = parseFloat(format.duration || stream.duration || "0");
              if (isNaN(duration) || duration <= 0) {
                console.error(`[Admin] Invalid duration:`, format.duration, stream.duration);
                reject(new Error(`Invalid video duration: ${format.duration || stream.duration || "unknown"}`));
                return;
              }

              const frameRate = stream.r_frame_rate?.split("/");
              let fps = frameRate && frameRate.length === 2
                ? parseFloat(frameRate[0]) / parseFloat(frameRate[1])
                : 30;

              if (isNaN(fps) || fps <= 0) {
                console.warn(`[Admin] Invalid FPS, using default 30. r_frame_rate:`, stream.r_frame_rate);
                fps = 30;
              }

              resolve({ duration, fps });
            } catch (e) {
              console.error(`[Admin] Failed to parse ffprobe output:`, e, "Output:", stdout);
              reject(new Error(`Failed to parse ffprobe output: ${e instanceof Error ? e.message : String(e)}`));
            }
          } else {
            console.error(`[Admin] ffprobe failed with code ${code}. stderr:`, stderr, "stdout:", stdout);
            reject(new Error(`ffprobe failed (code ${code}): ${stderr || "unknown error"}`));
          }
        });

        ffprobe.on("error", (err) => {
          console.error(`[Admin] ffprobe spawn error:`, err);
          reject(new Error(`Failed to run ffprobe: ${err.message}. Make sure ffprobe is installed.`));
        });
      });
    });
  });
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /admin/stats - получить статистику (защищено секретным ключом)
  fastify.get<{ Querystring: { key?: string } }>(
    "/admin/stats",
    async (request, reply) => {
      const { key } = request.query;

      // Проверка секретного ключа
      if (!key || key !== config.adminSecretKey) {
        return reply.status(401).send({ error: "Invalid admin key" });
      }

      // Текущая дата (начало дня)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Начало недели (понедельник)
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
      weekStart.setHours(0, 0, 0, 0);

      // Параллельно выполняем все запросы
      const [
        totalUsers,
        totalSessions,
        todaySessions,
        completedSessions,
        renderingNow,
        failedRenders,
        playerDistribution,
        weeklyStats,
        queueInfo,
      ] = await Promise.all([
        // Уникальные игроки
        prisma.participant.groupBy({
          by: ["tgUserId"],
          _count: true,
        }).then((r) => r.length),

        // Всего сессий
        prisma.session.count(),

        // Сессий сегодня
        prisma.session.count({
          where: { createdAt: { gte: todayStart } },
        }),

        // Завершённых (status = ready)
        prisma.session.count({
          where: { status: "ready" },
        }),

        // Сейчас рендерятся
        prisma.render.count({
          where: { status: "rendering" },
        }),

        // Провалились
        prisma.render.count({
          where: { status: "failed" },
        }),

        // Распределение по количеству игроков
        prisma.session.groupBy({
          by: ["maxPlayers"],
          _count: true,
        }),

        // Статистика по дням за неделю
        prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
          SELECT DATE("createdAt") as date, COUNT(*) as count
          FROM "Session"
          WHERE "createdAt" >= ${weekStart}
          GROUP BY DATE("createdAt")
          ORDER BY date
        `,

        // Очередь рендеров
        renderQueue.getJobCounts(),
      ]);

      // Форматируем распределение игроков
      const players: Record<string, number> = { solo: 0, duo: 0, trio: 0 };
      for (const p of playerDistribution) {
        if (p.maxPlayers === 1) players.solo = p._count;
        if (p.maxPlayers === 2) players.duo = p._count;
        if (p.maxPlayers === 3) players.trio = p._count;
      }

      // Форматируем недельную статистику
      const weekly = weeklyStats.map((row) => ({
        date: String(row.date),
        count: Number(row.count),
      }));

      // Конверсия
      const conversionRate = totalSessions > 0
        ? Math.round((completedSessions / totalSessions) * 100)
        : 0;

      return {
        timestamp: new Date().toISOString(),
        users: {
          total: totalUsers,
        },
        sessions: {
          total: totalSessions,
          today: todaySessions,
          completed: completedSessions,
          conversionRate: `${conversionRate}%`,
        },
        renders: {
          rendering: renderingNow,
          failed: failedRenders,
          queue: {
            waiting: queueInfo.waiting,
            active: queueInfo.active,
            delayed: queueInfo.delayed,
          },
        },
        playerDistribution: players,
        weekly,
      };
    }
  );

  // GET /admin/health - расширенная проверка здоровья
  fastify.get<{ Querystring: { key?: string } }>(
    "/admin/health",
    async (request, reply) => {
      const { key } = request.query;

      if (!key || key !== config.adminSecretKey) {
        return reply.status(401).send({ error: "Invalid admin key" });
      }

      const checks: Record<string, string> = {};

      // Database
      try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = "ok";
      } catch (e) {
        checks.database = `error: ${e}`;
      }

      // Redis (через queue)
      try {
        const counts = await renderQueue.getJobCounts();
        checks.redis = "ok";
        checks.queueJobs = JSON.stringify(counts);
      } catch (e) {
        checks.redis = `error: ${e}`;
      }

      const allOk = Object.values(checks).every((v) => v === "ok" || v.startsWith("{"));

      return {
        status: allOk ? "healthy" : "unhealthy",
        checks,
        timestamp: new Date().toISOString(),
      };
    }
  );

  // GET /admin/sessions - список последних сессий
  fastify.get<{ Querystring: { key?: string; limit?: string } }>(
    "/admin/sessions",
    async (request, reply) => {
      const { key, limit = "20" } = request.query;

      if (!key || key !== config.adminSecretKey) {
        return reply.status(401).send({ error: "Invalid admin key" });
      }

      const sessions = await prisma.session.findMany({
        take: Math.min(parseInt(limit), 100),
        orderBy: { createdAt: "desc" },
        include: {
          participants: {
            select: { displayName: true, roleIndex: true },
          },
          render: {
            select: { status: true },
          },
          _count: {
            select: { takes: true },
          },
        },
      });

      return sessions.map((s) => ({
        id: s.id,
        status: s.status,
        maxPlayers: s.maxPlayers,
        category: s.category,
        gameMode: s.gameMode,
        task: s.task,
        players: s.participants.map((p) => p.displayName),
        takesCount: s._count.takes,
        renderStatus: s.render?.status || null,
        createdAt: s.createdAt,
      }));
    }
  );

  // GET /admin/check - проверка прав админа
  fastify.get<{}>(
    "/admin/check",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const tgUser = (request as any).tgUser;
      const userId = tgUser?.id ? String(tgUser.id) : "";
      const isAdmin = config.adminTgUserIds.includes(userId);

      return { isAdmin };
    }
  );

  // GET /admin/scenes - список сцен
  fastify.get<{ Querystring: { page?: string; limit?: string; category?: string; search?: string } }>(
    "/admin/scenes",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const page = Math.max(1, parseInt(request.query.page || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || "20", 10)));
      const category = request.query.category;
      const search = request.query.search?.trim();

      const skip = (page - 1) * limit;

      // Build where clause
      const where: any = {};
      if (category) {
        where.category = category;
      }
      if (search) {
        where.title = { contains: search, mode: "insensitive" };
      }

      // Get total count
      const total = await prisma.scene.count({ where });

      // Get scenes
      const scenes = await prisma.scene.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      });

      const items: SceneListItem[] = scenes.map((scene) => {
        const filename = scene.s3Key.split("/").pop() || "";
        const videoUrl = getProxyUrl("scene", filename);

        return {
          id: scene.id,
          title: scene.title,
          category: scene.category as any,
          durationSec: scene.durationSec,
          fps: scene.fps,
          rolesCount: scene.rolesCount,
          createdAt: scene.createdAt.toISOString(),
          videoUrl,
        };
      });

      return {
        scenes: items,
        total,
        page,
        limit,
      } as ScenesListResponse;
    }
  );

  // GET /admin/scenes/:id - получить одну сцену
  fastify.get<{ Params: { id: string } }>(
    "/admin/scenes/:id",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const { id } = request.params;

      const scene = await prisma.scene.findUnique({
        where: { id },
      });

      if (!scene) {
        return reply.status(404).send({ error: "Scene not found" });
      }

      const filename = scene.s3Key.split("/").pop() || "";
      const videoUrl = getProxyUrl("scene", filename);
      const cues = parseCuesFromJson(scene.cueJson, scene.fps);

      return {
        id: scene.id,
        title: scene.title,
        category: scene.category as any,
        s3Key: scene.s3Key,
        durationSec: scene.durationSec,
        fps: scene.fps,
        rolesCount: scene.rolesCount,
        cueJson: scene.cueJson,
        createdAt: scene.createdAt.toISOString(),
        videoUrl,
        cues,
      } as SceneDetail;
    }
  );

  // POST /admin/scenes - загрузка новой сцены
  fastify.post<{}>(
    "/admin/scenes",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      let title = "";
      let category = "memes";
      let cuesJson = "";

      try {
        // Parse multipart - file streams MUST be consumed immediately
        const parts = request.parts();
        let videoBuffer: Buffer | null = null;
        
        for await (const part of parts) {
          if (part.type === "file") {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) {
              chunks.push(chunk);
            }
            videoBuffer = Buffer.concat(chunks);
          } else if (part.type === "field") {
            if (part.fieldname === "title") {
              title = String(part.value || "").trim();
            } else if (part.fieldname === "category") {
              category = String(part.value || "memes").trim();
            } else if (part.fieldname === "cues") {
              cuesJson = String(part.value || "").trim();
            }
          }
        }

      if (!videoBuffer || videoBuffer.length === 0) {
        return reply.status(400).send({ error: "No video file provided" });
      }

      if (!title) {
        return reply.status(400).send({ error: "Title is required" });
      }

      if (category !== "movies" && category !== "memes" && category !== "politics") {
        return reply.status(400).send({ error: "Invalid category. Must be movies, memes, or politics" });
      }

      let cues: Cue[];
      try {
        cues = JSON.parse(cuesJson);
        if (!Array.isArray(cues) || cues.length === 0) {
          return reply.status(400).send({ error: "Cues must be a non-empty array" });
        }
      } catch (e) {
        return reply.status(400).send({ error: "Invalid cues JSON format" });
      }

      // Save to temp file for ffprobe
      const tmpDir = path.join(os.tmpdir(), "dubdub-uploads");
      await mkdir(tmpDir, { recursive: true });
      const tmpPath = path.join(tmpDir, `${randomUUID()}.mp4`);
      await writeFile(tmpPath, videoBuffer);

      let tmpCutsPath: string | null = null;
      try {
        // Get video info
        const { duration, fps } = await getVideoInfo(tmpPath);

        // Validate cues
        if (!validateCues(cues, duration)) {
          return reply.status(400).send({ error: "Invalid cues: cues must not overlap and must be within video duration" });
        }

        // Convert cues to frames
        const cueFrames = cuesToFrames(cues, fps);

        // Generate scene ID
        const sceneId = `scene_${Date.now()}_${randomUUID().slice(0, 8)}`;
        const s3Key = storage.keys.scene(`${sceneId}.mp4`);
        const s3KeyCuts = storage.keys.scene(`${sceneId}_cuts.mp4`);

        // Create cuts version with audio muted at cue ranges
        tmpCutsPath = path.join(tmpDir, `${randomUUID()}_cuts.mp4`);
        await createCutsVideo(tmpPath, tmpCutsPath, cues, duration);

        // Read cuts video and upload both versions to S3
        const cutsBuffer = await import("fs/promises").then(fs => fs.readFile(tmpCutsPath!));
        await storage.upload(s3Key, videoBuffer, "video/mp4");
        await storage.upload(s3KeyCuts, cutsBuffer, "video/mp4");

        // Save to database
        const cueJson = JSON.stringify(cueFrames);
        await prisma.scene.create({
          data: {
            id: sceneId,
            title,
            category,
            s3Key,
            s3KeyCuts,
            durationSec: duration,
            fps,
            rolesCount: cues.length,
            cueJson,
          },
        });

        console.log(`[Admin] Scene created: ${sceneId}`);

        return reply.send({ success: true, sceneId });
      } catch (err: any) {
        await unlink(tmpPath).catch(() => {});
        if (tmpCutsPath) await unlink(tmpCutsPath).catch(() => {});
        console.error("[Admin] Failed to create scene:", err);
        return reply.status(500).send({ error: err.message || "Failed to create scene" });
      }
    } catch (err) {
      console.error("[Admin] Request processing error:", err);
      return reply.status(500).send({
        error: err instanceof Error ? err.message : "Failed to process request",
      });
    }
  }
  );

  // PUT /admin/scenes/:id - редактирование сцены
  fastify.put<{ Params: { id: string } }>(
    "/admin/scenes/:id",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const { id } = request.params;

      const scene = await prisma.scene.findUnique({
        where: { id },
      });

      if (!scene) {
        return reply.status(404).send({ error: "Scene not found" });
      }

      const updateData: any = {};
      let newVideoBuffer: Buffer | null = null;
      let tmpPath: string | null = null;
      let title: string | undefined;
      let category: string | undefined;
      let cuesJson: string | undefined;

      // Parse multipart form data
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          newVideoBuffer = Buffer.concat(chunks);
        } else if (part.type === "field") {
          if (part.fieldname === "title") {
            title = String(part.value || "").trim();
          } else if (part.fieldname === "category") {
            category = String(part.value || "").trim();
          } else if (part.fieldname === "cues") {
            cuesJson = String(part.value || "").trim();
          }
        }
      }

      try {
        // Handle video replacement
        if (newVideoBuffer) {
          // Save to temp file for ffprobe
          const tmpDir = path.join(os.tmpdir(), "dubdub-uploads");
          await mkdir(tmpDir, { recursive: true });
          tmpPath = path.join(tmpDir, `${randomUUID()}.mp4`);
          await writeFile(tmpPath, newVideoBuffer);

          // Get video info
          const { duration, fps } = await getVideoInfo(tmpPath);
          updateData.durationSec = duration;
          updateData.fps = fps;
        }

        // Handle title update
        if (title !== undefined) {
          if (title) {
            updateData.title = title;
          } else {
            return reply.status(400).send({ error: "Title cannot be empty" });
          }
        }

        // Handle category update
        if (category !== undefined) {
          const trimmedCategory = category.trim();
          if (trimmedCategory === "movies" || trimmedCategory === "memes" || trimmedCategory === "politics") {
            updateData.category = trimmedCategory;
          } else {
            return reply.status(400).send({ error: "Invalid category. Must be movies, memes, or politics" });
          }
        }

        // Handle cues update
        if (cuesJson !== undefined && cuesJson) {
          let cues: Cue[];
          try {
            const parsed = JSON.parse(cuesJson);
            if (!Array.isArray(parsed) || parsed.length === 0) {
              return reply.status(400).send({ error: "Cues must be a non-empty array" });
            }
            cues = parsed;
          } catch (e) {
            return reply.status(400).send({ error: "Invalid cues JSON format" });
          }

          const duration = updateData.durationSec || scene.durationSec;
          const fps = updateData.fps || scene.fps;

          // Validate cues
          if (!validateCues(cues, duration)) {
            return reply.status(400).send({ error: "Invalid cues: cues must not overlap and must be within video duration" });
          }

          // Convert to frames
          const cueFrames = cuesToFrames(cues, fps);
          updateData.cueJson = JSON.stringify(cueFrames);
          updateData.rolesCount = cues.length;
        }

        // If video is being replaced, upload new video and delete old one
        if (newVideoBuffer) {
          const newS3Key = storage.keys.scene(`${scene.id}.mp4`);
          await storage.upload(newS3Key, newVideoBuffer, "video/mp4");
          updateData.s3Key = newS3Key;

          // Delete old video from S3
          try {
            await storage.delete(scene.s3Key);
          } catch (err) {
            console.warn(`[Admin] Failed to delete old video from S3: ${scene.s3Key}`, err);
            // Don't fail the update if deletion fails
          }
        }

        // Update database
        const updated = await prisma.scene.update({
          where: { id },
          data: updateData,
        });

        console.log(`[Admin] Scene updated: ${id}`);

        // Build response
        const filename = updated.s3Key.split("/").pop() || "";
        const videoUrl = getProxyUrl("scene", filename);
        const cues = parseCuesFromJson(updated.cueJson, updated.fps);

        return {
          id: updated.id,
          title: updated.title,
          category: updated.category as any,
          s3Key: updated.s3Key,
          durationSec: updated.durationSec,
          fps: updated.fps,
          rolesCount: updated.rolesCount,
          cueJson: updated.cueJson,
          createdAt: updated.createdAt.toISOString(),
          videoUrl,
          cues,
        } as SceneDetail;
      } catch (err: any) {
        console.error("[Admin] Failed to update scene:", err);
        return reply.status(500).send({ error: err.message || "Failed to update scene" });
      } finally {
        // Clean up temp file
        if (tmpPath) {
          await unlink(tmpPath).catch(() => {});
        }
      }
    }
  );

  // DELETE /admin/scenes/:id - удаление сцены
  fastify.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    "/admin/scenes/:id",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const { id } = request.params;
      const force = request.query.force === "true";

      const scene = await prisma.scene.findUnique({
        where: { id },
      });

      if (!scene) {
        return reply.status(404).send({ error: "Scene not found" });
      }

      // Check for truly active sessions (created in the last hour with active status)
      // Old sessions in lobby/recording are likely abandoned
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentActiveSessions = await prisma.session.count({
        where: {
          sceneId: id,
          status: { in: ["lobby", "recording"] },
          createdAt: { gte: oneHourAgo },
        },
      });

      if (recentActiveSessions > 0 && !force) {
        return reply.status(400).send({
          error: `Cannot delete scene: ${recentActiveSessions} active session(s) using this scene. Use force=true to delete anyway.`,
          activeSessions: recentActiveSessions,
        });
      }

      // Delete video from S3
      try {
        await storage.delete(scene.s3Key);
      } catch (err) {
        console.warn(`[Admin] Failed to delete video from S3: ${scene.s3Key}`, err);
        // Continue with database deletion even if S3 deletion fails
      }

      // Delete related sessions first (they reference scene via foreign key)
      const deletedSessions = await prisma.session.deleteMany({
        where: { sceneId: id },
      });
      console.log(`[Admin] Deleted ${deletedSessions.count} sessions for scene ${id}`);

      // Delete scene from database
      await prisma.scene.delete({
        where: { id },
      });

      console.log(`[Admin] Scene deleted: ${id}${force ? " (forced)" : ""}`);

      return { success: true };
    }
  );
};


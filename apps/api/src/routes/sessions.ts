import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { storage } from "../lib/storage.js";
import { renderQueue } from "../lib/queue.js";
import { authMiddleware } from "../middleware/auth.js";
import { config } from "../config.js";
import { getProxyUrl } from "./files.js";
import {
  createSessionSchema,
  type CreateSessionResponse,
  type JoinSessionResponse,
  type SessionStateResponse,
  type UploadTakeResponse,
  type FinishSessionResponse,
  type SceneMeta,
  type Cue,
  type Category,
  type GameMode,
  type SessionStatus,
  parseCuesFromJson,
} from "@dubdub/shared";
import { spawn } from "child_process";
import { promisify } from "util";
import { pipeline as pipelineCallback } from "stream";
import { getRandomTask } from "../config/tasks.js";

const pipeline = promisify(pipelineCallback);

// parseCuesFromJson now imported from @dubdub/shared

function buildSceneMeta(scene: {
  id: string;
  title: string;
  durationSec: number;
  fps: number;
  rolesCount: number;
  cueJson: string;
}): SceneMeta {
  return {
    id: scene.id,
    title: scene.title,
    durationSec: scene.durationSec,
    fps: scene.fps,
    rolesCount: scene.rolesCount,
    cues: parseCuesFromJson(scene.cueJson, scene.fps),
  };
}

async function getAudioDuration(buffer: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      "-i", "pipe:0",
    ]);

    let output = "";
    ffprobe.stdout.on("data", (data) => {
      output += data.toString();
    });

    ffprobe.stderr.on("data", (data) => {
      console.error("ffprobe stderr:", data.toString());
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        resolve(isNaN(duration) ? 0 : duration);
      } else {
        reject(new Error(`ffprobe exited with code ${code}`));
      }
    });

    ffprobe.stdin.write(buffer);
    ffprobe.stdin.end();
  });
}

/**
 * Trim audio to exact duration (cut off anything longer)
 */
async function trimAudio(
  inputBuffer: Buffer,
  maxDurationSec: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Use sample-accurate atrim filter instead of -t for precision
    // atrim=start=0:duration=X - exact duration trimming
    // asetpts=PTS-STARTPTS - reset timestamps after trim for correct sync
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-ss", "0",  // Explicit start at 0
      "-af", `atrim=start=0:duration=${maxDurationSec},asetpts=PTS-STARTPTS`,
      "-c:a", "libopus",
      "-b:a", "128k",  // High quality opus
      "-ar", "48000",  // 48kHz sample rate
      "-f", "webm",
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];
    let stderrOutput = "";

    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (data) => {
      stderrOutput += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        console.error(`[TrimAudio] FFmpeg stderr:`, stderrOutput);
        reject(new Error(`ffmpeg trim failed with code ${code}: ${stderrOutput.substring(0, 200)}`));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(new Error(`ffmpeg spawn error: ${err.message}`));
    });

    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}

export const sessionsRoutes: FastifyPluginAsync = async (fastify) => {
  // Join by code - find session by last 8 characters of session ID
  fastify.post<{ Body: { code: string } }>(
    "/sessions/join-by-code",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { code } = request.body;
      
      if (!code || code.length < 6) {
        return reply.status(400).send({ error: "Неверный код" });
      }

      const normalizedCode = code.toUpperCase().trim();
      
      // Find session where ID ends with this code (case-insensitive)
      const sessions = await prisma.session.findMany({
        where: {
          status: { in: ["lobby", "recording"] }, // Only joinable sessions
        },
        orderBy: { createdAt: "desc" },
        take: 100, // Limit search
      });

      // Find matching session by last 8 chars
      const matchingSession = sessions.find(s => 
        s.id.slice(-8).toUpperCase() === normalizedCode ||
        s.id.slice(-normalizedCode.length).toUpperCase() === normalizedCode
      );

      if (!matchingSession) {
        return reply.status(404).send({ error: "Сессия не найдена или уже закрыта" });
      }

      return { sessionId: matchingSession.id };
    }
  );

  // Create session
  fastify.post<{ Body: { maxPlayers: number; category: Category; gameMode: GameMode } }>(
    "/sessions",
    { preHandler: authMiddleware },
    async (request, reply): Promise<CreateSessionResponse> => {
      const body = createSessionSchema.parse(request.body);
      const user = request.tgUser;

      // Get ALL scenes in this category - always pick random for simplicity
      const allScenes = await prisma.scene.findMany({
        where: { category: body.category },
      });

      if (allScenes.length === 0) {
        return reply.status(400).send({ error: `Нет сцен в категории "${body.category}"` });
      }

      // Pick a RANDOM scene - always random, no tracking
      const scene = allScenes[Math.floor(Math.random() * allScenes.length)]!;

      console.log(`[Session] User ${user.id} gets RANDOM scene ${scene.id} (category: ${body.category}, total: ${allScenes.length})`);

      // Set task only in "tasks" mode
      const task = body.gameMode === "tasks" ? getRandomTask() : null;

      const session = await prisma.session.create({
        data: {
          category: body.category,
          gameMode: body.gameMode,
          task,
          maxPlayers: body.maxPlayers,
          sceneId: scene.id,
          status: "lobby",
          createdByTgUserId: user.id,
        },
      });

      // Auto-join creator as first participant
      await prisma.participant.create({
        data: {
          sessionId: session.id,
          tgUserId: user.id,
          displayName: user.firstName,
          roleIndex: 0,
        },
      });

      // If single player, move to recording
      if (body.maxPlayers === 1) {
        await prisma.session.update({
          where: { id: session.id },
          data: { status: "recording" },
        });
      }

      return { sessionId: session.id };
    }
  );

  // Join session
  fastify.post<{ Params: { id: string } }>(
    "/sessions/:id/join",
    { preHandler: authMiddleware },
    async (request, reply): Promise<JoinSessionResponse> => {
      const { id } = request.params;
      const user = request.tgUser;

      const session = await prisma.session.findUnique({
        where: { id },
        include: {
          scene: true,
          participants: { orderBy: { roleIndex: "asc" } },
          takes: { orderBy: { roleIndex: "asc" } },
        },
      });

      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      // Check if already joined
      let participant = session.participants.find((p) => p.tgUserId === user.id);

      if (!participant) {
        if (session.status !== "lobby") {
          return reply.status(400).send({ error: "Session already started" });
        }

        if (session.participants.length >= session.maxPlayers) {
          return reply.status(400).send({ error: "Session is full" });
        }

        const roleIndex = session.participants.length;

        participant = await prisma.participant.create({
          data: {
            sessionId: id,
            tgUserId: user.id,
            displayName: user.firstName,
            roleIndex,
          },
        });

        // Check if session is now full
        const updatedCount = session.participants.length + 1;
        console.log(`[Join] User ${user.id} joined session ${id}. Participants: ${updatedCount}/${session.maxPlayers}`);
        if (updatedCount >= session.maxPlayers) {
          console.log(`[Join] Session ${id} is now full, updating status to "recording"`);
          await prisma.session.update({
            where: { id },
            data: { status: "recording" },
          });
        }
      }

      const currentTurn = session.takes.length;

      // Get scene URL (using proxy)
      const sceneFilename = session.scene.s3Key.split("/").pop() || "";
      const sceneUrl = getProxyUrl("scene", sceneFilename);

      // Get cuts video URL if available
      let sceneUrlCuts: string | undefined;
      if (session.scene.s3KeyCuts) {
        const cutsFilename = session.scene.s3KeyCuts.split("/").pop() || "";
        sceneUrlCuts = getProxyUrl("scene", cutsFilename);
      }

      return {
        participant: {
          id: participant.id,
          tgUserId: participant.tgUserId,
          displayName: participant.displayName,
          roleIndex: participant.roleIndex,
        },
        roleIndex: participant.roleIndex,
        category: session.category,
        task: session.task,
        gameMode: session.gameMode as GameMode,
        sceneMeta: buildSceneMeta(session.scene),
        sceneUrl,
        sceneUrlCuts,
        currentTurn,
      };
    }
  );

  // Get session state
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id",
    {
      preHandler: authMiddleware,
      config: {
        rateLimit: {
          max: 1200,
          timeWindow: "1 minute",
          keyGenerator: (req) =>
            req.tgUser?.id ? `tg:${req.tgUser.id}` : `ip:${req.ip}`,
        },
      },
    },
    async (request, reply): Promise<SessionStateResponse> => {
      const { id } = request.params;
      const user = request.tgUser;

      const session = await prisma.session.findUnique({
        where: { id },
        include: {
          scene: true,
          participants: { orderBy: { roleIndex: "asc" } },
          takes: { orderBy: { roleIndex: "asc" } },
          render: true,
        },
      });

      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      const myParticipant = session.participants.find(
        (p) => p.tgUserId === user.id
      );

      const currentTurn = session.takes.length;
      const sceneCues = parseCuesFromJson(session.scene.cueJson, session.scene.fps);
      const totalRoles = sceneCues.length;
      const isSolo = session.maxPlayers === 1;

      // In solo mode, myRoleIndex is the current turn (next role to record)
      // In multiplayer, it's the participant's assigned role
      const myRoleIndex = isSolo 
        ? (currentTurn < totalRoles ? currentTurn : null)  // null if all recorded
        : (myParticipant?.roleIndex ?? null);

      // Get scene URL (using proxy)
      const sceneFilename = session.scene.s3Key.split("/").pop() || "";
      const sceneUrl = getProxyUrl("scene", sceneFilename);

      // Get cuts video URL if available
      let sceneUrlCuts: string | undefined;
      if (session.scene.s3KeyCuts) {
        const cutsFilename = session.scene.s3KeyCuts.split("/").pop() || "";
        sceneUrlCuts = getProxyUrl("scene", cutsFilename);
      }

      // Get render video URL if ready (using proxy)
      let videoUrl: string | null = null;
      if (session.render?.status === "ready") {
        videoUrl = getProxyUrl("render", session.id);
      }

      return {
        session: {
          id: session.id,
          category: session.category as Category,
          gameMode: session.gameMode as GameMode,
          task: session.task,
          status: session.status as any,
          maxPlayers: session.maxPlayers,
          createdByTgUserId: session.createdByTgUserId,
          sceneMeta: buildSceneMeta(session.scene),
        },
        participants: session.participants.map((p) => ({
          id: p.id,
          tgUserId: p.tgUserId,
          displayName: p.displayName,
          roleIndex: p.roleIndex,
        })),
        currentTurn,
        takes: session.takes.map((t) => ({
          roleIndex: t.roleIndex,
          durationSec: t.durationSec,
        })),
        render: session.render
          ? {
              status: session.render.status as any,
              videoUrl,
            }
          : null,
        myRoleIndex,
        sceneUrl,
        sceneUrlCuts,
      };
    }
  );

  // Upload take
  fastify.post<{ Params: { id: string } }>(
    "/sessions/:id/take",
    { preHandler: authMiddleware },
    async (request, reply): Promise<UploadTakeResponse> => {
      const { id } = request.params;
      const user = request.tgUser;


      const session = await prisma.session.findUnique({
        where: { id },
        include: {
          scene: true,
          participants: true,
          takes: true,
        },
      });

      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      // Parse cues to know how many roles exist
      const sceneCues = parseCuesFromJson(session.scene.cueJson, session.scene.fps);
      const totalRoles = sceneCues.length;
      const isSolo = session.maxPlayers === 1;

      if (session.status !== "recording") {
        return reply.status(400).send({ error: "Session not in recording phase" });
      }

      const participant = session.participants.find(
        (p) => p.tgUserId === user.id
      );

      if (!participant) {
        return reply.status(403).send({ error: "Not a participant" });
      }

      const currentTurn = session.takes.length;

      // In solo mode, the single player records all roles sequentially
      // In multiplayer mode (2 players), both players can record simultaneously
      if (isSolo) {
        // Solo: check we haven't recorded all roles yet
        if (currentTurn >= totalRoles) {
          return reply.status(400).send({ error: "All roles already recorded" });
        }
      } else {
        // Multiplayer (2 players): check if already submitted (no turn-based restriction)
        // Both players can record simultaneously, but each can only record once
        const existingTake = session.takes.find(
          (t) => t.roleIndex === participant.roleIndex
        );
        if (existingTake) {
          return reply.status(400).send({ error: "Already submitted" });
        }
      }

      // Role index for this take
      const takeRoleIndex = isSolo ? currentTurn : participant.roleIndex;

      // Get cue duration for this role
      const cue = sceneCues.find((c: Cue) => c.roleIndex === takeRoleIndex);
      const cueDuration = cue?.durationSec || 5;

      // Get uploaded file
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No audio file" });
      }


      // Read file to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(chunks);


      // Check size
      const maxBytes = config.maxAudioSizeMb * 1024 * 1024;
      if (audioBuffer.length > maxBytes) {
        return reply.status(400).send({
          error: `File too large. Max: ${config.maxAudioSizeMb}MB`,
        });
      }

      // Get duration
      let durationSec: number;
      try {
        durationSec = await getAudioDuration(audioBuffer);
      } catch (err) {
        console.error("[Take] Failed to get audio duration:", err);
        durationSec = 5; // Default
      }

      // If duration is 0 or couldn't be determined, use cue duration
      if (durationSec <= 0) {
        durationSec = cueDuration;
      }

      // Trim audio if longer than cue duration
      let finalAudioBuffer: Buffer = audioBuffer;
      if (durationSec > cueDuration) {
        try {
          finalAudioBuffer = await trimAudio(audioBuffer, cueDuration);
          durationSec = cueDuration;
        } catch (err) {
          console.error("[Take] Trim failed:", err);
          // Continue with original if trim fails
        }
      }


      // Upload to S3 and create take record in transaction to prevent race conditions
      const s3Key = storage.keys.upload(id, takeRoleIndex);
      
      await prisma.$transaction(async (tx) => {
        // Upload to S3 first
        await storage.upload(s3Key, finalAudioBuffer, "audio/webm");
        
        // Then create or update take record (upsert prevents duplicates)
        await tx.take.upsert({
          where: {
            sessionId_roleIndex: {
              sessionId: id,
              roleIndex: takeRoleIndex,
            },
          },
          create: {
            sessionId: id,
            roleIndex: takeRoleIndex,
            s3Key,
            durationSec,
          },
          update: {
            s3Key,
            durationSec,
            createdAt: new Date(), // Update timestamp on retake
          },
        });
      });

      console.log("[Take] Saved take for role:", takeRoleIndex);

      // No previews - players don't hear each other for maximum chaos!

      return { ok: true };
    }
  );

  // Finish session (trigger render)
  fastify.post<{ Params: { id: string } }>(
    "/sessions/:id/finish",
    { preHandler: authMiddleware },
    async (request, reply): Promise<FinishSessionResponse> => {
      const { id } = request.params;
      const user = request.tgUser;

      const session = await prisma.session.findUnique({
        where: { id },
        include: { scene: true, takes: true },
      });

      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      // Check if user is a participant
      const participant = await prisma.participant.findFirst({
        where: {
          sessionId: id,
          tgUserId: user.id,
        },
      });

      if (!participant) {
        return reply.status(403).send({ error: "You are not a participant" });
      }

      // Check all roles recorded
      const sceneCues = parseCuesFromJson(session.scene.cueJson, session.scene.fps);
      const totalRoles = sceneCues.length;
      const isSolo = session.maxPlayers === 1;
      
      // In solo mode, need all roles recorded. In multiplayer, need all players.
      const requiredTakes = isSolo ? totalRoles : session.maxPlayers;
      
      if (session.takes.length < requiredTakes) {
        return reply.status(400).send({ 
          error: `Not all roles recorded. Got ${session.takes.length}, need ${requiredTakes}` 
        });
      }

      // Check if this user has recorded their take
      const userTake = session.takes.find(t => t.roleIndex === participant.roleIndex);
      if (!userTake) {
        return reply.status(400).send({ error: "You must record your take first" });
      }

      // In multiplayer: check if this is the last player to record (based on take creation time)
      if (!isSolo && session.takes.length === requiredTakes) {
        // Get all takes with their creation times
        const takesWithTimes = await prisma.take.findMany({
          where: { sessionId: id },
          select: { roleIndex: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        });
        
        // Check if this user's take is the most recent
        const lastTake = takesWithTimes[0];
        const userTakeRecord = takesWithTimes.find(t => t.roleIndex === participant.roleIndex);
        
        if (!userTakeRecord || !lastTake || lastTake.roleIndex !== participant.roleIndex) {
          return reply.status(400).send({ 
            error: "Only the last player to record can start rendering" 
          });
        }
      }

      if (session.status === "rendering" || session.status === "ready") {
        return reply.status(400).send({ error: "Already rendering/ready" });
      }

      // Create render record
      await prisma.render.upsert({
        where: { sessionId: id },
        create: { sessionId: id, status: "pending" },
        update: { status: "pending", s3Key: null, error: null },
      });

      // Update session status
      await prisma.session.update({
        where: { id },
        data: { status: "rendering" },
      });

      // Queue render job
      await renderQueue.add("render", { sessionId: id });

      return { queued: true };
    }
  );

  // Replay session (same scene or new scene)
  fastify.post<{ 
    Params: { id: string }; 
    Querystring: { mode: "sameScene" | "newScene" };
  }>(
    "/sessions/:id/replay",
    { preHandler: authMiddleware },
    async (request, reply): Promise<SessionStateResponse> => {
      const { id } = request.params;
      const { mode } = request.query;
      const user = request.tgUser;

      if (mode !== "sameScene" && mode !== "newScene") {
        return reply.status(400).send({ error: "Invalid mode. Use 'sameScene' or 'newScene'" });
      }

      // Get current session with participants and scene
      const session = await prisma.session.findUnique({
        where: { id },
        include: {
          scene: true,
          participants: { orderBy: { roleIndex: "asc" } },
          takes: true,
          render: true,
        },
      });

      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      // Check if user is a participant
      const participant = session.participants.find(p => p.tgUserId === user.id);
      if (!participant) {
        return reply.status(403).send({ error: "Not a participant" });
      }

      // Check if session is in ready state (can only replay finished sessions)
      if (session.status !== "ready") {
        return reply.status(400).send({ 
          error: `Session must be finished to replay. Current status: ${session.status}` 
        });
      }

      // Use transaction to ensure atomicity
      const updatedSession = await prisma.$transaction(async (tx) => {
        // 1. Delete all takes
        await tx.take.deleteMany({
          where: { sessionId: id },
        });

        // 2. Delete render if exists
        await tx.render.deleteMany({
          where: { sessionId: id },
        });

        let newSceneId = session.sceneId;
        let updatedParticipants = session.participants;

        // 3. Handle scene and role redistribution
        if (mode === "newScene") {
          // Find ALL sessions by this user in the same category (all statuses)
          const usedSessionsByCreator = await tx.session.findMany({
            where: {
              category: session.category,
              createdByTgUserId: user.id,
              status: { in: ["lobby", "recording", "rendering", "ready"] },
            },
            select: { sceneId: true },
          });

          const usedSessionsAsParticipant = await tx.session.findMany({
            where: {
              category: session.category,
              status: { in: ["lobby", "recording", "rendering", "ready"] },
              participants: {
                some: { tgUserId: user.id },
              },
            },
            select: { sceneId: true },
          });

          // Combine and get unique scene IDs (include current scene to exclude it)
          const allUsedSceneIds = new Set([
            ...usedSessionsByCreator.map((s) => s.sceneId),
            ...usedSessionsAsParticipant.map((s) => s.sceneId),
          ]);

          const usedSceneIds = Array.from(allUsedSceneIds);

          console.log(`[Replay] User ${user.id} used scenes in ${session.category}: ${usedSceneIds.length} scenes`);

          // Find ALL available scenes excluding used ones
          const availableScenes = await tx.scene.findMany({
            where: {
              category: session.category,
              id: { notIn: usedSceneIds.length > 0 ? usedSceneIds : ["__none__"] },
            },
          });

          // Pick a RANDOM scene from available ones
          let newScene = availableScenes.length > 0
            ? availableScenes[Math.floor(Math.random() * availableScenes.length)]
            : null;

          // If all scenes in category played, pick any RANDOM one (excluding current, reset cycle)
          if (!newScene) {
            const allOtherScenes = await tx.scene.findMany({
              where: { 
                category: session.category,
                id: { not: session.sceneId },
              },
            });
            newScene = allOtherScenes.length > 0
              ? allOtherScenes[Math.floor(Math.random() * allOtherScenes.length)]
              : null;
          }

          if (!newScene) {
            throw new Error(`No other scenes available in category "${session.category}"`);
          }

          console.log(`[Replay] Selected RANDOM scene: ${newScene.id} (category: ${session.category}, used: ${usedSceneIds.length}, available: ${availableScenes.length})`);

          newSceneId = newScene.id;

          // Fisher-Yates shuffle for truly random role distribution
          const shuffledParticipants = [...session.participants];
          for (let i = shuffledParticipants.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledParticipants[i], shuffledParticipants[j]] = [shuffledParticipants[j]!, shuffledParticipants[i]!];
          }
          
          // Update participants with new roleIndex (0 and 1 for 2 players)
          for (let i = 0; i < shuffledParticipants.length; i++) {
            const p = shuffledParticipants[i];
            if (!p) continue;
            if (i < 2) { // Only first 2 players (maxPlayers should be 2)
              await tx.participant.update({
                where: { id: p.id },
                data: { roleIndex: i },
              });
            }
          }

          // Reload participants after update
          updatedParticipants = await tx.participant.findMany({
            where: { sessionId: id },
            orderBy: { roleIndex: "asc" },
          });
        }
        // For sameScene: keep same sceneId and roleIndex (no changes needed)

        // 4. Update session
        const updated = await tx.session.update({
          where: { id },
          data: {
            sceneId: newSceneId,
            status: "recording", // Start recording immediately
            task: session.gameMode === "tasks" ? getRandomTask() : null,
            // Keep: category, gameMode, task, maxPlayers, createdByTgUserId
          },
          include: {
            scene: true,
            participants: { orderBy: { roleIndex: "asc" } },
            takes: true,
            render: true,
          },
        });

        return updated;
      });

      // Get scene URL
      const sceneFilename = updatedSession.scene.s3Key.split("/").pop() || "";
      const sceneUrl = getProxyUrl("scene", sceneFilename);

      // Get cuts video URL if available
      let sceneUrlCuts: string | undefined;
      if (updatedSession.scene.s3KeyCuts) {
        const cutsFilename = updatedSession.scene.s3KeyCuts.split("/").pop() || "";
        sceneUrlCuts = getProxyUrl("scene", cutsFilename);
      }

      // Parse cues
      const sceneCues = parseCuesFromJson(updatedSession.scene.cueJson, updatedSession.scene.fps);
      const sceneMeta: SceneMeta = buildSceneMeta(updatedSession.scene);

      // Build response
      const myParticipant = updatedSession.participants.find(
        (p) => p.tgUserId === user.id
      );

      const isSolo = updatedSession.maxPlayers === 1;
      const totalRoles = sceneCues.length;
      const currentTurn = updatedSession.takes.length;

      return {
        session: {
          id: updatedSession.id,
          category: updatedSession.category as Category,
          gameMode: updatedSession.gameMode as GameMode,
          task: updatedSession.task ?? null,
          status: updatedSession.status as SessionStatus,
          maxPlayers: updatedSession.maxPlayers,
          createdByTgUserId: updatedSession.createdByTgUserId,
          sceneMeta,
        },
        participants: updatedSession.participants.map((p) => ({
          id: p.id,
          tgUserId: p.tgUserId ?? null,
          displayName: p.displayName,
          roleIndex: p.roleIndex,
        })),
        myRoleIndex: isSolo
          ? (currentTurn < totalRoles ? currentTurn : null)
          : (myParticipant?.roleIndex ?? null),
        currentTurn,
        takes: updatedSession.takes.map((t) => ({
          roleIndex: t.roleIndex,
          durationSec: t.durationSec,
        })),
        render: updatedSession.render && updatedSession.render.status === "ready" && updatedSession.render.s3Key ? {
          status: updatedSession.render.status as any,
          videoUrl: getProxyUrl("render", updatedSession.render.s3Key.split("/").pop() || ""),
        } : null,
        sceneUrl,
        sceneUrlCuts,
      };
    }
  );

  // Request replay (for multiplayer - requires confirmation from other player)
  fastify.post<{ 
    Params: { id: string }; 
    Querystring: { mode: "sameScene" | "newScene" };
  }>(
    "/sessions/:id/request-replay",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params;
      const { mode } = request.query;
      const user = request.tgUser;

      if (mode !== "sameScene" && mode !== "newScene") {
        return reply.status(400).send({ error: "Invalid mode" });
      }

      const session = await prisma.session.findUnique({
        where: { id },
        include: { participants: true },
      });

      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      // Check if user is a participant
      const participant = session.participants.find(p => p.tgUserId === user.id);
      if (!participant) {
        return reply.status(403).send({ error: "Not a participant" });
      }

      // For solo games, just trigger replay directly
      if (session.maxPlayers === 1) {
        // Redirect to regular replay
        return reply.status(200).send({ 
          directReplay: true,
          message: "Solo game - replay directly" 
        });
      }

      // For multiplayer, create replay request
      const replayRequest = {
        requestedBy: user.id,
        requestedByName: user.firstName,
        mode,
        requestedAt: new Date().toISOString(),
      };

      await prisma.session.update({
        where: { id },
        data: { replayRequest: JSON.stringify(replayRequest) },
      });

      console.log(`[ReplayRequest] User ${user.id} requested ${mode} for session ${id}`);

      return { 
        requested: true,
        waitingForConfirmation: true,
      };
    }
  );

  // Confirm replay (second player confirms)
  fastify.post<{ 
    Params: { id: string };
    Querystring: { confirm: string }; // "true" or "false"
  }>(
    "/sessions/:id/confirm-replay",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params;
      const confirm = request.query.confirm === "true";
      const user = request.tgUser;

      const session = await prisma.session.findUnique({
        where: { id },
        include: { participants: true },
      });

      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      // Check if user is a participant
      const participant = session.participants.find(p => p.tgUserId === user.id);
      if (!participant) {
        return reply.status(403).send({ error: "Not a participant" });
      }

      // Check if there's a pending request
      if (!session.replayRequest) {
        return reply.status(400).send({ error: "No pending replay request" });
      }

      const replayReq = JSON.parse(session.replayRequest) as {
        requestedBy: string;
        requestedByName: string;
        mode: "sameScene" | "newScene";
        requestedAt: string;
      };

      // Can't confirm own request (compare as strings)
      if (String(replayReq.requestedBy) === String(user.id)) {
        return reply.status(400).send({ error: "Cannot confirm own request" });
      }

      if (!confirm) {
        // Declined - clear request
        await prisma.session.update({
          where: { id },
          data: { replayRequest: null },
        });
        console.log(`[ReplayRequest] User ${user.id} declined replay for session ${id}`);
        return { declined: true };
      }

      // Confirmed! Clear request and mark for replay execution
      // Set a special status to indicate replay is confirmed
      await prisma.session.update({
        where: { id },
        data: { 
          replayRequest: JSON.stringify({
            ...replayReq,
            confirmedBy: user.id,
            confirmedAt: new Date().toISOString(),
          }),
        },
      });

      console.log(`[ReplayRequest] User ${user.id} confirmed ${replayReq.mode} for session ${id}`);

      return { 
        confirmed: true,
        mode: replayReq.mode,
      };
    }
  );

  // Get replay request status
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/replay-status",
    {
      preHandler: authMiddleware,
      config: {
        rateLimit: {
          max: 1200,
          timeWindow: "1 minute",
          keyGenerator: (req) =>
            req.tgUser?.id ? `tg:${req.tgUser.id}` : `ip:${req.ip}`,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const user = request.tgUser;

      const session = await prisma.session.findUnique({
        where: { id },
        select: { replayRequest: true, maxPlayers: true, participants: true },
      });

      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      if (!session.replayRequest) {
        return { pending: false };
      }

      const replayReq = JSON.parse(session.replayRequest) as {
        requestedBy: string;
        requestedByName: string;
        mode: "sameScene" | "newScene";
        requestedAt: string;
        confirmedBy?: string;
        confirmedAt?: string;
      };

      // Compare as strings (user.id is number, requestedBy is string)
      const isRequester = String(replayReq.requestedBy) === String(user.id);
      
      console.log(`[ReplayStatus] User ${user.id} checking status. requestedBy: ${replayReq.requestedBy}, isRequester: ${isRequester}`);

      return {
        pending: true,
        mode: replayReq.mode,
        requestedBy: replayReq.requestedBy,
        requestedByName: replayReq.requestedByName,
        isRequester,
        confirmed: !!replayReq.confirmedBy,
      };
    }
  );

  // Execute confirmed replay (after confirmation)
  fastify.post<{ Params: { id: string } }>(
    "/sessions/:id/execute-replay",
    { preHandler: authMiddleware },
    async (request, reply): Promise<SessionStateResponse> => {
      const { id } = request.params;
      const user = request.tgUser;

      const session = await prisma.session.findUnique({
        where: { id },
        include: {
          scene: true,
          participants: { orderBy: { roleIndex: "asc" } },
          takes: true,
          render: true,
        },
      });

      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      // Check if user is a participant
      const participant = session.participants.find(p => p.tgUserId === user.id);
      if (!participant) {
        return reply.status(403).send({ error: "Not a participant" });
      }

      // For solo games, no confirmation needed
      if (session.maxPlayers > 1) {
        // Check if replay was confirmed
        if (!session.replayRequest) {
          return reply.status(400).send({ error: "No replay request" });
        }

        const replayReq = JSON.parse(session.replayRequest) as {
          requestedBy: string;
          mode: "sameScene" | "newScene";
          confirmedBy?: string;
        };

        if (!replayReq.confirmedBy) {
          return reply.status(400).send({ error: "Replay not confirmed yet" });
        }
      }

      // Get mode from request or use newScene as default for solo
      let mode: "sameScene" | "newScene" = "newScene";
      if (session.replayRequest) {
        const replayReq = JSON.parse(session.replayRequest);
        mode = replayReq.mode;
      }

      // Execute the replay (same logic as original /replay endpoint)
      const updatedSession = await prisma.$transaction(async (tx) => {
        // Delete takes and render
        await tx.take.deleteMany({ where: { sessionId: id } });
        await tx.render.deleteMany({ where: { sessionId: id } });

        let newSceneId = session.sceneId;
        let updatedParticipants = session.participants;

        if (mode === "newScene") {
          // Get ALL scenes in this category
          const allScenes = await tx.scene.findMany({
            where: { category: session.category },
          });

          // Filter out current scene to ensure we always get a different one
          const otherScenes = allScenes.filter(s => s.id !== session.sceneId);

          console.log(`[Replay] Category: ${session.category}, Total scenes: ${allScenes.length}, Other scenes: ${otherScenes.length}, Current: ${session.sceneId}`);

          let newScene = otherScenes.length > 0
            ? otherScenes[Math.floor(Math.random() * otherScenes.length)]
            : null;

          // If only one scene exists, use the same one
          if (!newScene && allScenes.length > 0) {
            newScene = allScenes[0];
            console.log(`[Replay] Only one scene available, reusing: ${newScene?.id}`);
          }

          if (!newScene) {
            throw new Error(`No scenes available in category "${session.category}"`);
          }

          console.log(`[Replay] Selected new scene: ${newScene.id}`);
          newSceneId = newScene.id;

          // Shuffle roles for multiplayer
          if (session.maxPlayers > 1) {
            const shuffledParticipants = [...session.participants];
            for (let i = shuffledParticipants.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffledParticipants[i], shuffledParticipants[j]] = [shuffledParticipants[j]!, shuffledParticipants[i]!];
            }
            
            for (let i = 0; i < shuffledParticipants.length; i++) {
              const p = shuffledParticipants[i];
              if (!p || i >= 2) continue;
              await tx.participant.update({
                where: { id: p.id },
                data: { roleIndex: i },
              });
            }

            updatedParticipants = await tx.participant.findMany({
              where: { sessionId: id },
              orderBy: { roleIndex: "asc" },
            });
          }
        }

        // Update session - for multiplayer, all players are already in, so go to recording
        const allPlayersReady = session.participants.length >= session.maxPlayers;
        return await tx.session.update({
          where: { id },
          data: {
            sceneId: newSceneId,
            status: allPlayersReady ? "recording" : "lobby",
            replayRequest: null, // Clear the request
            task: session.gameMode === "tasks" ? getRandomTask() : null,
          },
          include: {
            scene: true,
            participants: { orderBy: { roleIndex: "asc" } },
            takes: true,
            render: true,
          },
        });
      });

      // Build response (same as original)
      const sceneMeta = buildSceneMeta(updatedSession.scene);
      const sceneUrl = getProxyUrl("scene", updatedSession.scene.s3Key);
      const sceneUrlCuts = updatedSession.scene.s3KeyCuts 
        ? getProxyUrl("scene", updatedSession.scene.s3KeyCuts) 
        : undefined;

      const myParticipant = updatedSession.participants.find(p => p.tgUserId === user.id);
      const isSolo = updatedSession.maxPlayers === 1;
      const totalRoles = sceneMeta.cues.length;
      const currentTurn = updatedSession.takes.length;

      return {
        session: {
          id: updatedSession.id,
          category: updatedSession.category as Category,
          gameMode: updatedSession.gameMode as GameMode,
          task: updatedSession.task ?? null,
          status: updatedSession.status as SessionStatus,
          maxPlayers: updatedSession.maxPlayers,
          createdByTgUserId: updatedSession.createdByTgUserId,
          sceneMeta,
        },
        participants: updatedSession.participants.map((p) => ({
          id: p.id,
          tgUserId: p.tgUserId ?? null,
          displayName: p.displayName,
          roleIndex: p.roleIndex,
        })),
        myRoleIndex: isSolo
          ? (currentTurn < totalRoles ? currentTurn : null)
          : (myParticipant?.roleIndex ?? null),
        currentTurn,
        takes: updatedSession.takes.map((t) => ({
          roleIndex: t.roleIndex,
          durationSec: t.durationSec,
        })),
        render: null,
        sceneUrl,
        sceneUrlCuts,
      };
    }
  );
};


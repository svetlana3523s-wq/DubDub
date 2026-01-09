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
} from "@dubdub/shared";
import { spawn } from "child_process";
import { promisify } from "util";
import { pipeline as pipelineCallback } from "stream";

const pipeline = promisify(pipelineCallback);

// Tasks for "tasks" game mode
const TASKS = [
  "Озвучь в стиле ужастиков категории Б",
  "Озвучь КРАЙНЕ эмоционально",
  "Озвучь с кавказским акцентом",
  "Озвучь используя самое необычное нецензурное слово которое ты знаешь",
  "Озвучь в стиле укурыша",
  "Озвучь в стиле гоблина",
  "Озвучь издавая звуки животного",
  "Озвучь страстно",
  "Озвучь пошло",
  "Озвучь голосом монстра",
  "Озвучь в стиле Гитлера",
];

function getRandomTask(): string {
  return TASKS[Math.floor(Math.random() * TASKS.length)] ?? TASKS[0]!;
}

/**
 * Parse cueJson - supports both old format (seconds) and new format (frames)
 */
function parseCuesFromJson(cueJson: string, fps: number): Cue[] {
  const raw = JSON.parse(cueJson) as any[];
  
  return raw.map((cue) => {
    // New format: frames
    if ('startFrame' in cue) {
      return {
        roleIndex: cue.roleIndex,
        startSec: cue.startFrame / fps,
        durationSec: cue.durationFrames / fps,
      };
    }
    // Old format: seconds (backwards compatibility)
    return {
      roleIndex: cue.roleIndex,
      startSec: cue.startSec,
      durationSec: cue.durationSec,
    };
  });
}

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
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-t", String(maxDurationSec),
      "-c:a", "libopus",
      "-b:a", "128k",  // High quality opus
      "-ar", "48000",  // 48kHz sample rate
      "-f", "webm",
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", () => {}); // Ignore stderr

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg trim failed with code ${code}`));
      }
    });

    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}

export const sessionsRoutes: FastifyPluginAsync = async (fastify) => {
  // Create session
  fastify.post<{ Body: { maxPlayers: number; category: Category; gameMode: GameMode } }>(
    "/sessions",
    { preHandler: authMiddleware },
    async (request, reply): Promise<CreateSessionResponse> => {
      const body = createSessionSchema.parse(request.body);
      const user = request.tgUser;

      // Get scenes the user has already completed in this category
      const completedSessions = await prisma.session.findMany({
        where: {
          status: "ready",
          category: body.category,
          participants: {
            some: { tgUserId: user.id },
          },
        },
        select: { sceneId: true },
      });
      const usedSceneIds = completedSessions.map((s) => s.sceneId);

      // Find a scene the user hasn't played yet in this category
      let scene = await prisma.scene.findFirst({
        where: {
          category: body.category,
          id: { notIn: usedSceneIds.length > 0 ? usedSceneIds : ["__none__"] },
        },
        orderBy: { createdAt: "desc" }, // Prefer newer scenes
      });

      // If all scenes in category played, pick any from this category (reset cycle)
      if (!scene) {
        scene = await prisma.scene.findFirst({
          where: { category: body.category },
          orderBy: { createdAt: "desc" },
        });
      }

      if (!scene) {
        return reply.status(400).send({ error: `Нет сцен в категории "${body.category}"` });
      }

      console.log(`[Session] User ${user.id} gets scene ${scene.id} (category: ${body.category}, used: ${usedSceneIds.length})`);

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
        currentTurn,
      };
    }
  );

  // Get session state
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id",
    { preHandler: authMiddleware },
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

      console.log("[Take] Request:", { sessionId: id, tgUserId: user.id });

      const session = await prisma.session.findUnique({
        where: { id },
        include: {
          scene: true,
          participants: true,
          takes: true,
        },
      });

      if (!session) {
        console.log("[Take] Session not found");
        return reply.status(404).send({ error: "Session not found" });
      }

      // Parse cues to know how many roles exist
      const sceneCues = parseCuesFromJson(session.scene.cueJson, session.scene.fps);
      const totalRoles = sceneCues.length;
      const isSolo = session.maxPlayers === 1;

      console.log("[Take] Session:", { 
        status: session.status, 
        maxPlayers: session.maxPlayers,
        isSolo,
        totalRoles,
        takes: session.takes.length,
        participants: session.participants.map(p => ({ tgUserId: p.tgUserId, roleIndex: p.roleIndex })) 
      });

      if (session.status !== "recording") {
        console.log("[Take] Session not in recording phase:", session.status);
        return reply.status(400).send({ error: "Session not in recording phase" });
      }

      const participant = session.participants.find(
        (p) => p.tgUserId === user.id
      );

      if (!participant) {
        console.log("[Take] Not a participant. User:", user.id, "Participants:", session.participants.map(p => p.tgUserId));
        return reply.status(403).send({ error: "Not a participant" });
      }

      const currentTurn = session.takes.length;

      // In solo mode, the single player records all roles sequentially
      // In multiplayer mode (2 players), both players can record simultaneously
      if (isSolo) {
        // Solo: check we haven't recorded all roles yet
        if (currentTurn >= totalRoles) {
          console.log("[Take] All roles already recorded in solo mode");
          return reply.status(400).send({ error: "All roles already recorded" });
        }
      } else {
        // Multiplayer (2 players): check if already submitted (no turn-based restriction)
        // Both players can record simultaneously, but each can only record once
        const existingTake = session.takes.find(
          (t) => t.roleIndex === participant.roleIndex
        );
        if (existingTake) {
          console.log("[Take] Already submitted for role:", participant.roleIndex);
          return reply.status(400).send({ error: "Already submitted" });
        }
      }

      // Role index for this take
      const takeRoleIndex = isSolo ? currentTurn : participant.roleIndex;

      // Get cue duration for this role
      const cue = sceneCues.find(c => c.roleIndex === takeRoleIndex);
      const cueDuration = cue?.durationSec || 5;
      console.log("[Take] Cue duration for role", takeRoleIndex, ":", cueDuration);

      // Get uploaded file
      const data = await request.file();
      if (!data) {
        console.log("[Take] No audio file in request");
        return reply.status(400).send({ error: "No audio file" });
      }

      console.log("[Take] File received:", { filename: data.filename, mimetype: data.mimetype });

      // Read file to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(chunks);

      console.log("[Take] Audio buffer size:", audioBuffer.length);

      // Check size
      const maxBytes = config.maxAudioSizeMb * 1024 * 1024;
      if (audioBuffer.length > maxBytes) {
        console.log("[Take] File too large:", audioBuffer.length);
        return reply.status(400).send({
          error: `File too large. Max: ${config.maxAudioSizeMb}MB`,
        });
      }

      // Get duration
      let durationSec: number;
      try {
        durationSec = await getAudioDuration(audioBuffer);
        console.log("[Take] Audio duration:", durationSec);
      } catch (err) {
        console.error("[Take] Failed to get audio duration:", err);
        durationSec = 5; // Default
      }

      // If duration is 0 or couldn't be determined, use cue duration
      if (durationSec <= 0) {
        console.log("[Take] Duration not detected, using cue duration:", cueDuration);
        durationSec = cueDuration;
      }

      // Trim audio if longer than cue duration
      let finalAudioBuffer: Buffer = audioBuffer;
      if (durationSec > cueDuration) {
        console.log("[Take] Trimming audio from", durationSec, "to", cueDuration);
        try {
          finalAudioBuffer = await trimAudio(audioBuffer, cueDuration);
          durationSec = cueDuration;
        } catch (err) {
          console.error("[Take] Trim failed:", err);
          // Continue with original if trim fails
        }
      }

      console.log("[Take] Final duration:", durationSec);

      // Upload to S3
      const s3Key = storage.keys.upload(id, takeRoleIndex);
      await storage.upload(s3Key, finalAudioBuffer, "audio/webm");

      // Create take record
      await prisma.take.create({
        data: {
          sessionId: id,
          roleIndex: takeRoleIndex,
          s3Key,
          durationSec,
        },
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
          // Find unused scenes in the same category (exclude current scene)
          const completedSessions = await tx.session.findMany({
            where: {
              status: "ready",
              category: session.category,
              participants: {
                some: { tgUserId: user.id },
              },
            },
            select: { sceneId: true },
          });
          const usedSceneIds = completedSessions.map((s) => s.sceneId);

          // Find a scene the user hasn't played yet (excluding current scene)
          let newScene = await tx.scene.findFirst({
            where: {
              category: session.category,
              id: { 
                notIn: [...usedSceneIds, session.sceneId], 
              },
            },
            orderBy: { createdAt: "desc" },
          });

          // If all scenes played, pick any from category (excluding current)
          if (!newScene) {
            newScene = await tx.scene.findFirst({
              where: { 
                category: session.category,
                id: { not: session.sceneId },
              },
              orderBy: { createdAt: "desc" },
            });
          }

          if (!newScene) {
            throw new Error(`No other scenes available in category "${session.category}"`);
          }

          newSceneId = newScene.id;

          // Shuffle participants and reassign roleIndex (0 and 1)
          const shuffledParticipants = [...session.participants].sort(() => Math.random() - 0.5);
          
          // Update participants with new roleIndex
          for (let i = 0; i < shuffledParticipants.length; i++) {
            const p = shuffledParticipants[i];
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
          task: updatedSession.task || undefined,
          status: updatedSession.status,
          maxPlayers: updatedSession.maxPlayers,
          createdByTgUserId: updatedSession.createdByTgUserId,
          sceneMeta,
          sceneUrl,
        },
        participants: updatedSession.participants.map((p) => ({
          id: p.id,
          tgUserId: p.tgUserId,
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
      };
    }
  );
};


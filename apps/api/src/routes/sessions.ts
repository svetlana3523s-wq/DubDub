import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { storage } from "../lib/storage.js";
import { renderQueue } from "../lib/queue.js";
import { authMiddleware } from "../middleware/auth.js";
import { config } from "../config.js";
import {
  createSessionSchema,
  type CreateSessionResponse,
  type JoinSessionResponse,
  type SessionStateResponse,
  type UploadTakeResponse,
  type FinishSessionResponse,
  type SceneMeta,
  type Cue,
} from "@dubdub/shared";
import { spawn } from "child_process";
import { promisify } from "util";
import { pipeline as pipelineCallback } from "stream";

const pipeline = promisify(pipelineCallback);

// Topics for random selection
const TOPICS = [
  "Первое свидание в зоопарке",
  "Собеседование на должность космонавта",
  "Семейный ужин на Марсе",
  "Переговоры между пиратами и русалками",
  "Последний день динозавров",
  "Открытие нового вида картошки",
  "Встреча выпускников школы магии",
  "Конференция домашних животных",
  "Дипломатический скандал из-за борща",
  "Романтика в очереди за iPhone",
];

function getRandomTopic(): string {
  return TOPICS[Math.floor(Math.random() * TOPICS.length)] ?? TOPICS[0]!;
}

function parseCues(cueJson: string): Cue[] {
  return JSON.parse(cueJson) as Cue[];
}

function buildSceneMeta(scene: {
  id: string;
  title: string;
  durationSec: number;
  rolesCount: number;
  cueJson: string;
}): SceneMeta {
  return {
    id: scene.id,
    title: scene.title,
    durationSec: scene.durationSec,
    rolesCount: scene.rolesCount,
    cues: parseCues(scene.cueJson),
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

async function createPreview(
  inputBuffer: Buffer,
  startPercent: number,
  endPercent: number
): Promise<Buffer> {
  const duration = await getAudioDuration(inputBuffer);
  const startSec = (duration * startPercent) / 100;
  const clipDuration = (duration * (endPercent - startPercent)) / 100;

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-ss", String(startSec),
      "-t", String(clipDuration),
      "-c:a", "libopus",
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
        reject(new Error(`ffmpeg preview failed with code ${code}`));
      }
    });

    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}

export const sessionsRoutes: FastifyPluginAsync = async (fastify) => {
  // Create session
  fastify.post<{ Body: { maxPlayers: number } }>(
    "/sessions",
    { preHandler: authMiddleware },
    async (request, reply): Promise<CreateSessionResponse> => {
      const body = createSessionSchema.parse(request.body);
      const user = request.tgUser;

      // Get first available scene
      const scene = await prisma.scene.findFirst();
      if (!scene) {
        return reply.status(500).send({ error: "No scenes available" });
      }

      const topic = getRandomTopic();

      const session = await prisma.session.create({
        data: {
          mode: "absurd",
          topic,
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
        if (updatedCount >= session.maxPlayers) {
          await prisma.session.update({
            where: { id },
            data: { status: "recording" },
          });
        }
      }

      const currentTurn = session.takes.length;

      // Get preview URL for this player
      let previewUrl: string | null = null;
      if (participant.roleIndex > 0 && participant.roleIndex <= currentTurn) {
        const prevRoleIndex = participant.roleIndex - 1;
        const prevTake = session.takes.find((t) => t.roleIndex === prevRoleIndex);
        if (prevTake) {
          try {
            previewUrl = await storage.getSignedUrl(
              storage.keys.preview(id, participant.roleIndex)
            );
          } catch {
            // Preview may not exist yet
          }
        }
      }

      // Get scene URL
      const sceneUrl = await storage.getSignedUrl(session.scene.s3Key);

      return {
        participant: {
          id: participant.id,
          tgUserId: participant.tgUserId,
          displayName: participant.displayName,
          roleIndex: participant.roleIndex,
        },
        roleIndex: participant.roleIndex,
        topic: session.topic,
        sceneMeta: buildSceneMeta(session.scene),
        sceneUrl,
        currentTurn,
        previewUrl,
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

      // Get preview URL for current user
      let previewUrl: string | null = null;
      if (myParticipant && myParticipant.roleIndex > 0) {
        try {
          previewUrl = await storage.getSignedUrl(
            storage.keys.preview(id, myParticipant.roleIndex)
          );
        } catch {
          // Preview may not exist
        }
      }

      // Get scene URL
      const sceneUrl = await storage.getSignedUrl(session.scene.s3Key);

      // Get render video URL if ready
      let videoUrl: string | null = null;
      if (session.render?.status === "ready" && session.render.s3Key) {
        videoUrl = await storage.getSignedUrl(session.render.s3Key);
      }

      return {
        session: {
          id: session.id,
          mode: session.mode,
          topic: session.topic,
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
        myRoleIndex: myParticipant?.roleIndex ?? null,
        previewUrl,
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
          participants: true,
          takes: true,
        },
      });

      if (!session) {
        console.log("[Take] Session not found");
        return reply.status(404).send({ error: "Session not found" });
      }

      console.log("[Take] Session:", { status: session.status, participants: session.participants.map(p => ({ tgUserId: p.tgUserId, roleIndex: p.roleIndex })) });

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

      if (participant.roleIndex !== currentTurn) {
        console.log("[Take] Not your turn:", { currentTurn, roleIndex: participant.roleIndex });
        return reply.status(400).send({
          error: `Not your turn. Current turn: ${currentTurn}, your role: ${participant.roleIndex}`,
        });
      }

      // Check if already submitted
      const existingTake = session.takes.find(
        (t) => t.roleIndex === participant.roleIndex
      );
      if (existingTake) {
        console.log("[Take] Already submitted");
        return reply.status(400).send({ error: "Already submitted" });
      }

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
        // Use default duration if ffprobe fails
        durationSec = 5;
      }

      // Validate duration (relaxed: 1-30 seconds)
      if (durationSec < 1 || durationSec > 30) {
        console.log("[Take] Duration out of range:", durationSec);
        return reply.status(400).send({
          error: `Audio must be 1-30 seconds. Got: ${durationSec.toFixed(1)}s`,
        });
      }

      // Upload to S3
      const s3Key = storage.keys.upload(id, participant.roleIndex);
      await storage.upload(s3Key, audioBuffer, "audio/webm");

      // Create take record
      await prisma.take.create({
        data: {
          sessionId: id,
          roleIndex: participant.roleIndex,
          s3Key,
          durationSec,
        },
      });

      // Create preview for next player
      const nextRoleIndex = participant.roleIndex + 1;
      if (nextRoleIndex < session.maxPlayers) {
        try {
          // Player 2 hears first 50% of player 1
          // Player 3 hears last 50% of player 2
          const startPercent = nextRoleIndex === 1 ? 0 : 50;
          const endPercent = nextRoleIndex === 1 ? 50 : 100;

          const previewBuffer = await createPreview(
            audioBuffer,
            startPercent,
            endPercent
          );

          await storage.upload(
            storage.keys.preview(id, nextRoleIndex),
            previewBuffer,
            "audio/webm"
          );
        } catch (err) {
          console.error("Failed to create preview:", err);
          // Continue even if preview fails
        }
      }

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
        include: { takes: true },
      });

      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      // Only creator can finish
      if (session.createdByTgUserId !== user.id) {
        return reply.status(403).send({ error: "Only host can finish" });
      }

      if (session.takes.length < session.maxPlayers) {
        return reply.status(400).send({ error: "Not all players recorded" });
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
};


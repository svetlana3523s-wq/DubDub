import { Telegraf } from "telegraf";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { PrismaClient } from "@prisma/client";
import { Readable } from "stream";

const prisma = new PrismaClient();
const bot = new Telegraf(config.botToken);

const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
  forcePathStyle: true,
});

const bucket = config.s3.bucket;

// Size thresholds in bytes
const SIZE_THRESHOLD_SMALL = 20 * 1024 * 1024; // 20MB
const SIZE_THRESHOLD_LARGE = 50 * 1024 * 1024; // 50MB

export interface SendTelegramInput {
  sessionId: string;
  telegramUserId: string;
  s3Key: string;
}

/**
 * Get file size from S3 without downloading
 */
async function getFileSize(s3Key: string): Promise<number> {
  const response = await s3Client.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    })
  );
  return response.ContentLength || 0;
}

/**
 * Send video via URL method (for small files)
 */
async function sendViaUrl(
  sessionId: string,
  telegramUserId: string,
  videoUrl: string,
  caption: string
): Promise<void> {
  const chatId = parseInt(telegramUserId, 10);
  await bot.telegram.sendVideo(chatId, { url: videoUrl }, {
    caption,
    supports_streaming: true,
    reply_markup: {
      keyboard: [
        [{ text: "🎭 Начать игру" }],
        [{ text: "👥 Присоединиться к игре" }],
        [{ text: "💡 Предложить эпизод" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    },
  });
}

/**
 * Send video via Buffer (for medium files, 20-50MB)
 * Downloads from S3 and sends as Buffer
 * Note: For very large files, this will use significant memory
 */
async function sendViaBuffer(
  sessionId: string,
  telegramUserId: string,
  s3Key: string,
  caption: string
): Promise<void> {
  const chatId = parseInt(telegramUserId, 10);
  
  // Download from S3
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    })
  );
  
  const stream = response.Body as Readable;
  const chunks: Buffer[] = [];
  
  // Collect stream into buffer
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  
  const videoBuffer = Buffer.concat(chunks);
  
  // Send via Telegram API with buffer
  await bot.telegram.sendVideo(
    chatId,
    { source: videoBuffer, filename: `dubdub-${sessionId}.mp4` },
    {
      caption,
      supports_streaming: true,
      reply_markup: {
        keyboard: [
          [{ text: "🎭 Начать игру" }],
          [{ text: "👥 Присоединиться к игре" }],
          [{ text: "💡 Предложить эпизод" }],
        ],
        resize_keyboard: true,
        is_persistent: true,
      },
    }
  );
}

/**
 * Main function to send video to Telegram
 */
export async function sendVideoToTelegram(input: SendTelegramInput): Promise<void> {
  const { sessionId, telegramUserId, s3Key } = input;
  
  console.log(`[SendTelegram:${sessionId}] Starting send job for user ${telegramUserId}`);

  try {
    // Get render data for caption
    const render = await prisma.render.findUnique({
      where: { sessionId },
      include: { session: true },
    });

    if (!render || !render.session) {
      throw new Error("Render or session not found");
    }

    const caption = `🎬 Ваш дубляж ${render.session.task ? `"${render.session.task}"` : ""}\n\nСоздано в @${config.botUsername}`;
    const videoUrl = `${config.apiBaseUrl}/files/renders/${sessionId}.mp4`;

    // Get file size
    const fileSize = await getFileSize(s3Key);
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    console.log(`[SendTelegram:${sessionId}] File size: ${fileSizeMB}MB`);

    // Update status to "sending"
    await prisma.render.update({
      where: { sessionId },
      data: { 
        sendStatus: "sending",
        sendAttempts: { increment: 1 },
      },
    });

    // Choose strategy based on file size
    if (fileSize > SIZE_THRESHOLD_LARGE) {
      // Too large - mark as too_large
      await prisma.render.update({
        where: { sessionId },
        data: {
          sendStatus: "too_large",
          sendError: `Файл слишком большой (${fileSizeMB}MB). Максимум 50MB.`,
        },
      });
      throw new Error(`File too large: ${fileSizeMB}MB (max 50MB)`);
    } else if (fileSize <= SIZE_THRESHOLD_SMALL) {
      // Small file - use URL method
      console.log(`[SendTelegram:${sessionId}] Using URL method (${fileSizeMB}MB)`);
      await sendViaUrl(sessionId, telegramUserId, videoUrl, caption);
    } else {
      // Medium file - use buffer method
      console.log(`[SendTelegram:${sessionId}] Using buffer method (${fileSizeMB}MB)`);
      await sendViaBuffer(sessionId, telegramUserId, s3Key, caption);
    }

    // Success - update status
    await prisma.render.update({
      where: { sessionId },
      data: {
        sendStatus: "sent",
        sendError: null,
      },
    });

    console.log(`[SendTelegram:${sessionId}] Successfully sent video to ${telegramUserId}`);
  } catch (err: any) {
    const errorMessage = err.message || String(err);
    const isTooLarge = errorMessage.includes("too large") || errorMessage.includes("too_large");
    
    // Don't update status if already marked as too_large
    if (!isTooLarge) {
      await prisma.render.update({
        where: { sessionId },
        data: {
          sendStatus: "failed",
          sendError: errorMessage.substring(0, 200), // Limit error length
        },
      });
    }

    console.error(`[SendTelegram:${sessionId}] Failed to send:`, errorMessage);
    throw err; // Re-throw to allow BullMQ retry
  }
}


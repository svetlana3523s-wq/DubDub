import { Telegraf } from "telegraf";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { PrismaClient } from "@prisma/client";
import { Readable } from "stream";
import { createWriteStream, createReadStream, unlink } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { promisify } from "util";

const unlinkAsync = promisify(unlink);

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

// Size threshold in bytes
const SIZE_THRESHOLD_LARGE = 50 * 1024 * 1024; // 50MB

export interface SendTelegramInput {
  sessionId: string;
  telegramUserId: string;
  s3Key: string;
}

// Custom error for rate limiting
export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter: number
  ) {
    super(message);
    this.name = "RateLimitError";
  }
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
 * Send video via upload (downloads to temp file, then uploads to Telegram)
 * Uses temporary file to avoid loading entire file into RAM
 */
async function sendViaUpload(
  sessionId: string,
  telegramUserId: string,
  s3Key: string,
  caption: string
): Promise<string> {
  const chatId = parseInt(telegramUserId, 10);
  
  // Create temporary file path
  const tempFile = join(tmpdir(), `dubdub-${sessionId}-${Date.now()}.mp4`);
  
  try {
    // Download from S3 to temp file (streaming, doesn't load into RAM)
    const downloadStartTime = Date.now();
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: s3Key,
      })
    );
    
    const stream = response.Body as Readable;
    const writeStream = createWriteStream(tempFile);
    
    // Pipe S3 stream to temp file
    await new Promise<void>((resolve, reject) => {
      stream.pipe(writeStream);
      stream.on("error", reject);
      writeStream.on("error", reject);
      writeStream.on("finish", resolve);
    });
    
    const downloadTime = Date.now() - downloadStartTime;
    console.log(`[SendTelegram:${sessionId}] [${downloadTime}ms] Downloaded to temp file: ${tempFile}`);
    
    // Send via Telegram API using file stream
    const uploadStartTime = Date.now();
    await bot.telegram.sendVideo(
      chatId,
      { source: createReadStream(tempFile), filename: `dubdub-${sessionId}.mp4` },
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
    
    const uploadTime = Date.now() - uploadStartTime;
    console.log(`[SendTelegram:${sessionId}] [${uploadTime}ms] Telegram upload completed`);
    
    return tempFile;
  } catch (err) {
    // Clean up temp file on error
    try {
      await unlinkAsync(tempFile).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Main function to send video to Telegram
 */
export async function sendVideoToTelegram(input: SendTelegramInput): Promise<void> {
  const { sessionId, telegramUserId, s3Key } = input;
  
  const startTime = Date.now();
  console.log(`[SendTelegram:${sessionId}] [${startTime}] Starting send job for user ${telegramUserId}`);

  try {
    // Get render data for caption
    const renderStartTime = Date.now();
    const render = await prisma.render.findUnique({
      where: { sessionId },
      include: { session: true },
    });
    console.log(`[SendTelegram:${sessionId}] [${Date.now() - renderStartTime}ms] Render data fetched`);

    if (!render || !render.session) {
      throw new Error("Render or session not found");
    }

    // Get RenderSend record (should exist - created by API endpoint)
    const renderSend = await prisma.renderSend.findUnique({
      where: {
        renderId_telegramUserId: {
          renderId: render.id,
          telegramUserId: telegramUserId,
        },
      },
    });

    if (!renderSend) {
      throw new Error(`RenderSend not found for render ${render.id}, user ${telegramUserId}`);
    }

    const caption = `🎬 Ваш дубляж ${render.session.task ? `"${render.session.task}"` : ""}\n\nСоздано в @${config.botUsername}`;

    // Get file size (HEAD request to S3)
    const sizeCheckStartTime = Date.now();
    const fileSize = await getFileSize(s3Key);
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    console.log(`[SendTelegram:${sessionId}] [${Date.now() - sizeCheckStartTime}ms] File size checked: ${fileSizeMB}MB`);

    // Update status to "sending"
    await prisma.renderSend.update({
      where: { id: renderSend.id },
      data: { 
        status: "sending",
        attempts: { increment: 1 },
      },
    });

    // Check file size limit
    if (fileSize > SIZE_THRESHOLD_LARGE) {
      // Too large - mark as too_large
      await prisma.renderSend.update({
        where: { id: renderSend.id },
        data: {
          status: "too_large",
          error: `Файл слишком большой (${fileSizeMB}MB). Максимум 50MB.`,
        },
      });
      throw new Error(`File too large: ${fileSizeMB}MB (max 50MB)`);
    }

    // For all files <=50MB, use upload method (download to temp file, then upload)
    console.log(`[SendTelegram:${sessionId}] Using upload method (${fileSizeMB}MB)`);
    const sendStartTime = Date.now();
    let tempFile: string | null = null;
    
    try {
      tempFile = await sendViaUpload(sessionId, telegramUserId, s3Key, caption);
      const sendTime = Date.now() - sendStartTime;
      console.log(`[SendTelegram:${sessionId}] [${sendTime}ms] Total send time (download_to_temp + telegram_upload)`);
    } finally {
      // Clean up temp file
      if (tempFile) {
        try {
          await unlinkAsync(tempFile);
          console.log(`[SendTelegram:${sessionId}] Temp file deleted: ${tempFile}`);
        } catch (err) {
          console.error(`[SendTelegram:${sessionId}] Failed to delete temp file ${tempFile}:`, err);
        }
      }
    }

    // Success - update status (clear error and retryAfterSeconds)
    await prisma.renderSend.update({
      where: { id: renderSend.id },
      data: {
        status: "sent",
        error: null,
        retryAfterSeconds: null,
      },
    });

    const totalTime = Date.now() - startTime;
    console.log(`[SendTelegram:${sessionId}] [${totalTime}ms] Successfully sent video. renderId=${render.id}, telegramUserId=${telegramUserId}, status=sent`);
  } catch (err: any) {
    const errorMessage = err.message || String(err);
    const isTooLarge = errorMessage.includes("too large") || errorMessage.includes("too_large");
    
    // Check for Telegram API 429 rate limit error
    // Telegraf wraps Telegram API errors, check multiple possible locations for retry_after
    // Telegram API returns: { ok: false, error_code: 429, parameters: { retry_after: N } }
    // Telegraf may expose this as: err.response.parameters.retry_after or err.parameters?.retry_after
    const retryAfterValue = 
      err.response?.parameters?.retry_after ||
      err.parameters?.retry_after ||
      err.response?.retry_after ||
      (err.response?.error_code === 429 ? (err.response?.parameters?.retry_after || 60) : undefined);
    
    const isRateLimit = 
      err.response?.error_code === 429 ||
      err.code === 429 ||
      errorMessage.includes("Too Many Requests") ||
      errorMessage.includes("429") ||
      retryAfterValue !== undefined;
    
    // Get render to find RenderSend
    const render = await prisma.render.findUnique({
      where: { sessionId },
    });

    if (!render) {
      console.error(`[SendTelegram:${sessionId}] Render not found for error handling`);
      throw err;
    }

    const renderSend = await prisma.renderSend.findUnique({
      where: {
        renderId_telegramUserId: {
          renderId: render.id,
          telegramUserId: telegramUserId,
        },
      },
    });

    if (!renderSend) {
      console.error(`[SendTelegram:${sessionId}] RenderSend not found for error handling`);
      throw err;
    }

    if (isRateLimit) {
      // Extract retry_after (in seconds) from Telegram API response
      // Use actual value from API or default to 60 seconds
      const retryAfter = retryAfterValue || 60;
      
      console.log(`[SendTelegram:${sessionId}] Rate limit detected. Error structure:`, {
        error_code: err.response?.error_code,
        code: err.code,
        response_parameters: err.response?.parameters,
        parameters: err.parameters,
        extracted_retry_after: retryAfter,
      });
      
      // Update status to rate_limited (not an error for user)
      // IMPORTANT: error=null - do NOT store "Too many requests" as error for UI
      await prisma.renderSend.update({
        where: { id: renderSend.id },
        data: {
          status: "rate_limited",
          error: null, // Don't store error - rate_limited is not an error, UI will show neutral message
          retryAfterSeconds: retryAfter,
        },
      });
      
      console.log(`[SendTelegram:${sessionId}] Rate limited, retry after ${retryAfter}s. renderId=${render.id}, telegramUserId=${telegramUserId}, status=rate_limited`);
      // Throw RateLimitError to let worker delay the job
      throw new RateLimitError(`Rate limited: retry after ${retryAfter}s`, retryAfter);
    }
    
    // Don't update status if already marked as too_large
    if (!isTooLarge) {
      await prisma.renderSend.update({
        where: { id: renderSend.id },
        data: {
          status: "failed",
          error: errorMessage.substring(0, 200), // Limit error length
        },
      });
    }

    const totalTime = Date.now() - startTime;
    console.error(`[SendTelegram:${sessionId}] [${totalTime}ms] Failed to send:`, errorMessage);
    throw err; // Re-throw to allow BullMQ retry
  }
}


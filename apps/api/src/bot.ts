import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { storage } from "./lib/storage.js";
import { botState } from "./lib/bot-state.js";
import { getVideoInfo } from "./lib/video-utils.js";
import { spawn } from "child_process";
import { writeFile, unlink, mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";

// Categories imported from config
import { SCENE_CATEGORIES, CATEGORY_LABELS, type SceneCategory } from "./config/categories.js";

// ╨б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╡ ╨┤╨╕╨░╨╗╨╛╨│╨░ ╨┤╨╗╤П ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╕╤П ╤Б╤Ж╨╡╨╜
interface PendingScene {
  userId: number;
  fileId?: string; // Telegram file_id (╨╡╤Б╨╗╨╕ ╨╖╨░╨│╤А╤Г╨╢╨╡╨╜╨╛ ╤З╨╡╤А╨╡╨╖ Telegram)
  fileUrl?: string; // ╨Я╤А╤П╨╝╨░╤П ╤Б╤Б╤Л╨╗╨║╨░ ╨╜╨░ ╤Д╨░╨╣╨╗ (╨╡╤Б╨╗╨╕ ╨╖╨░╨│╤А╤Г╨╢╨╡╨╜╨╛ ╨┐╨╛ URL)
  duration: number;
  fps: number;
  totalFrames: number;
  step: "awaiting_title" | "awaiting_category" | "awaiting_cues";
  title?: string;
  category?: SceneCategory;
}

// ╨б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╡ ╨┤╨╕╨░╨╗╨╛╨│╨░ ╨┤╨╗╤П ╤А╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╜╨╕╤П ╤Б╤Ж╨╡╨╜
interface PendingEdit {
  userId: number;
  sceneId: string;
  step: "awaiting_sceneId" | "awaiting_new_cues";
  scene?: {
    id: string;
    title: string;
    duration: number;
    fps: number;
    totalFrames: number;
  };
}

// Pending states now stored in Redis via botState service (see lib/bot-state.ts)

function isAdmin(userId: number): boolean {
  return config.adminTgUserIds.includes(String(userId));
}

// getVideoInfo imported from ./lib/video-utils.js

async function downloadTelegramFile(
  bot: Telegraf,
  fileId: string
): Promise<{ buffer: Buffer; path: string }> {
  // ╨Я╨╛╨╗╤Г╤З╨░╨╡╨╝ ╨╕╨╜╤Д╨╛╤А╨╝╨░╤Ж╨╕╤О ╨╛ ╤Д╨░╨╣╨╗╨╡
  const file = await bot.telegram.getFile(fileId);
  
  // ╨б╤В╤А╨╛╨╕╨╝ URL ╨┤╨╗╤П ╤Б╨║╨░╤З╨╕╨▓╨░╨╜╨╕╤П (╨┤╨╗╤П ╨▒╨╛╨╗╤М╤И╨╕╤Е ╤Д╨░╨╣╨╗╨╛╨▓ ╨╜╤Г╨╢╨╜╨╛ ╨╕╤Б╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╤М ╤В╨╛╨║╨╡╨╜ ╨▒╨╛╤В╨░)
  const botToken = config.botToken;
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
  
  // ╨б╨║╨░╤З╨╕╨▓╨░╨╡╨╝ ╤Д╨░╨╣╨╗
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }
  
  const buffer = Buffer.from(await response.arrayBuffer());
  
  const tmpDir = path.join(os.tmpdir(), "dubdub-uploads");
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `${randomUUID()}.mp4`);
  await writeFile(tmpPath, buffer);
  
  return { buffer, path: tmpPath };
}

/**
 * ╨б╨║╨░╤З╨╕╨▓╨░╨╡╤В ╤Д╨░╨╣╨╗ ╨┐╨╛ ╨┐╤А╤П╨╝╨╛╨╣ ╤Б╤Б╤Л╨╗╨║╨╡ (URL)
 * ╨Я╨╛╨┤╨┤╨╡╤А╨╢╨╕╨▓╨░╨╡╤В ╤Д╨░╨╣╨╗╤Л ╨╗╤О╨▒╨╛╨│╨╛ ╤А╨░╨╖╨╝╨╡╤А╨░
 */
async function downloadFileFromUrl(fileUrl: string): Promise<{ buffer: Buffer; path: string }> {
  
  // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝, ╤З╤В╨╛ ╤Н╤В╨╛ ╨▓╨░╨╗╨╕╨┤╨╜╤Л╨╣ URL
  try {
    const url = new URL(fileUrl);
    
    // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝, ╤З╤В╨╛ ╤Н╤В╨╛ ╨╜╨╡ ╤Б╤Б╤Л╨╗╨║╨░ ╨╜╨░ ╤Б╤В╤А╨░╨╜╨╕╤Ж╤Г (╨╜╨░╨┐╤А╨╕╨╝╨╡╤А, ╨п╨╜╨┤╨╡╨║╤Б.╨Ф╨╕╤Б╨║)
    if (url.hostname.includes('yandex.ru') || url.hostname.includes('disk.yandex')) {
      throw new Error("Yandex.Disk link detected. Please provide direct download link. For Yandex.Disk: right-click on file тЖТ 'Get link' тЖТ copy direct link, or use /d/ link.");
    }
    
    if (url.hostname.includes('drive.google.com')) {
      throw new Error("Google Drive link detected. Please provide direct download link. Extract file ID and use: https://drive.google.com/uc?export=download&id=FILE_ID");
    }
  } catch (err: any) {
    if (err.message.includes("Yandex") || err.message.includes("Google")) {
      throw err;
    }
    throw new Error("Invalid URL");
  }
  
  // ╨б╨║╨░╤З╨╕╨▓╨░╨╡╨╝ ╤Д╨░╨╣╨╗
  const response = await fetch(fileUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'video/*, application/octet-stream, */*',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download file from URL: ${response.status} ${response.statusText}`);
  }
  
  // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝ Content-Type (╨┤╨╛╨╗╨╢╨╡╨╜ ╨▒╤Л╤В╤М video ╨╕╨╗╨╕ octet-stream)
  const contentType = response.headers.get('content-type') || '';
  const contentLength = response.headers.get('content-length');
  
  
  // ╨Х╤Б╨╗╨╕ ╤Н╤В╨╛ HTML - ╨╖╨╜╨░╤З╨╕╤В ╤Б╨║╨░╤З╨░╨╗╨░╤Б╤М ╤Б╤В╤А╨░╨╜╨╕╤Ж╨░, ╨░ ╨╜╨╡ ╤Д╨░╨╣╨╗
  if (contentType.includes('text/html')) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const htmlPreview = buffer.toString('utf-8', 0, Math.min(500, buffer.length));
    console.error(`[Bot] Downloaded HTML instead of video. Preview:`, htmlPreview);
    throw new Error("The link points to a web page, not a video file. Please provide a direct download link to the video file (ending with .mp4, .avi, etc.).");
  }
  
  if (!contentType.startsWith('video/') && !contentType.includes('octet-stream') && !contentType.includes('application/')) {
    console.warn(`[Bot] Warning: Unexpected content-type: ${contentType}`);
  }
  
  // ╨б╨║╨░╤З╨╕╨▓╨░╨╡╨╝ ╤Д╨░╨╣╨╗
  const buffer = Buffer.from(await response.arrayBuffer());
  
  // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝ ╨╝╨╕╨╜╨╕╨╝╨░╨╗╤М╨╜╤Л╨╣ ╤А╨░╨╖╨╝╨╡╤А (╨▓╨╕╨┤╨╡╨╛ ╨┤╨╛╨╗╨╢╨╜╨╛ ╨▒╤Л╤В╤М ╤Е╨╛╤В╤П ╨▒╤Л ╨╜╨╡╤Б╨║╨╛╨╗╤М╨║╨╛ KB)
  if (buffer.length < 1024) {
    throw new Error(`Downloaded file is too small (${buffer.length} bytes). This might be an error page or redirect. Please check the link.`);
  }
  
  // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝, ╤З╤В╨╛ ╤Н╤В╨╛ ╨┤╨╡╨╣╤Б╤В╨▓╨╕╤В╨╡╨╗╤М╨╜╨╛ ╨▒╨╕╨╜╨░╤А╨╜╤Л╨╣ ╤Д╨░╨╣╨╗ (╨╜╨╡ HTML)
  const fileStart = buffer.toString('utf-8', 0, Math.min(100, buffer.length));
  if (fileStart.toLowerCase().includes('<!doctype') || fileStart.toLowerCase().includes('<html')) {
    throw new Error("The link points to an HTML page, not a video file. Please provide a direct download link to the video file.");
  }
  
  const tmpDir = path.join(os.tmpdir(), "dubdub-uploads");
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `${randomUUID()}.mp4`);
  await writeFile(tmpPath, buffer);
  
  
  return { buffer, path: tmpPath };
}

/**
 * ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╤В, ╤П╨▓╨╗╤П╨╡╤В╤Б╤П ╨╗╨╕ ╤В╨╡╨║╤Б╤В ╨▓╨░╨╗╨╕╨┤╨╜╤Л╨╝ URL
 */
function isValidUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Parse cues in FRAMES format
 * ╨Я╨╛╨┤╨┤╨╡╤А╨╢╨╕╨▓╨░╨╡╤В ╤Д╨╛╤А╨╝╨░╤В╤Л:
 * - "0-125, 150-275" (╨║╨░╨┤╤А╤Л ╤З╨╡╤А╨╡╨╖ ╨╖╨░╨┐╤П╤В╤Г╤О)
 * - "╨Ш╨│╤А╨╛╨║ 1 тАФ 280 - 367" (╤Д╨╛╤А╨╝╨░╤В ╤Б ╨┐╤А╨╡╤Д╨╕╨║╤Б╨╛╨╝)
 * - "0 125, 150 275" (╨║╨░╨┤╤А╤Л ╤З╨╡╤А╨╡╨╖ ╨┐╤А╨╛╨▒╨╡╨╗)
 */
function parseCuesFrames(text: string): Array<{ startFrame: number; endFrame: number }> | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const cues: Array<{ startFrame: number; endFrame: number }> = [];

  for (const line of lines) {
    
    // ╨д╨╛╤А╨╝╨░╤В 1: "╨Ш╨│╤А╨╛╨║ N тАФ startFrame - endFrame" ╨╕╨╗╨╕ "╨Ш╨│╤А╨╛╨║ N тАФ startFrame - endFrame"
    // ╨Я╨╛╨┤╨┤╨╡╤А╨╢╨╕╨▓╨░╨╡╨╝ ╤А╨░╨╖╨╜╤Л╨╡ ╤В╨╕╨┐╤Л ╨┤╨╡╤Д╨╕╤Б╨╛╨▓: тАФ (em-dash), тАУ (en-dash), - (hyphen)
    let match = line.match(/(?:╨Ш╨│╤А╨╛╨║|Player|╨а╨╛╨╗╤М|╨а╨╡╨┐╨╗╨╕╨║╨░|╨а╨╛╨╗╨╕╨║)\s*\d+\s*[тАФтАУ\-]\s*(\d+)\s*[тАФтАУ\-]\s*(\d+)/i);
    if (match) {
      const startFrame = parseInt(match[1]!, 10);
      const endFrame = parseInt(match[2]!, 10);
      if (!isNaN(startFrame) && !isNaN(endFrame) && startFrame < endFrame) {
        cues.push({ startFrame, endFrame });
      }
      continue;
    }

    // ╨д╨╛╤А╨╝╨░╤В 2: ╨Я╤А╨╛╤Б╤В╨╛ "startFrame - endFrame" ╨╕╨╗╨╕ "startFrame-endFrame" (╨▒╨╡╨╖ ╨┐╤А╨╡╤Д╨╕╨║╤Б╨░ "╨Ш╨│╤А╨╛╨║")
    match = line.match(/^(\d+)\s*[тАФтАУ\-]\s*(\d+)$/);
    if (match) {
      const startFrame = parseInt(match[1]!, 10);
      const endFrame = parseInt(match[2]!, 10);
      if (!isNaN(startFrame) && !isNaN(endFrame) && startFrame < endFrame) {
        cues.push({ startFrame, endFrame });
      }
      continue;
    }

    // ╨д╨╛╤А╨╝╨░╤В 3: "0-125" ╨╕╨╗╨╕ "0-125, 150-275" (╨╛╨▒╤Л╤З╨╜╤Л╨╣ ╤Д╨╛╤А╨╝╨░╤В ╤З╨╡╤А╨╡╨╖ ╨╖╨░╨┐╤П╤В╤Г╤О)
    const parts = line.split(/[,\s]+/).filter(Boolean);
    for (const part of parts) {
      const match2 = part.match(/^(\d+)-(\d+)$/);
      if (match2) {
        const startFrame = parseInt(match2[1]!, 10);
        const endFrame = parseInt(match2[2]!, 10);
        if (!isNaN(startFrame) && !isNaN(endFrame) && startFrame < endFrame) {
          cues.push({ startFrame, endFrame });
        }
      }
    }

    // ╨д╨╛╤А╨╝╨░╤В 4: "0 125" (╨║╨░╨┤╤А╤Л ╤З╨╡╤А╨╡╨╖ ╨┐╤А╨╛╨▒╨╡╨╗, ╨▒╨╡╨╖ ╨┤╨╡╤Д╨╕╤Б╨░)
    const spaceMatch = line.match(/^(\d+)\s+(\d+)$/);
    if (spaceMatch) {
      const startFrame = parseInt(spaceMatch[1]!, 10);
      const endFrame = parseInt(spaceMatch[2]!, 10);
      if (!isNaN(startFrame) && !isNaN(endFrame) && startFrame < endFrame) {
        cues.push({ startFrame, endFrame });
      }
    }
  }

  // ╨б╨╛╤А╤В╨╕╤А╨╛╨▓╨░╤В╤М ╨┐╨╛ startFrame
  cues.sort((a, b) => a.startFrame - b.startFrame);

  return cues.length > 0 ? cues : null;
}

export function createBot(): Telegraf {
  const bot = new Telegraf(config.botToken);

  // Main menu keyboard - ╨▓╤Б╨╡╨│╨┤╨░ ╨╛╤В╨╛╨▒╤А╨░╨╢╨░╨╡╤В╤Б╤П ╨▓╨╜╨╕╨╖╤Г
  // For admins, will include admin panel button
  const getMainMenuKeyboard = (userId?: number) => {
    const baseKeyboard = [
      [
        { text: "ЁЯОн ╨Э╨░╤З╨░╤В╤М ╨╕╨│╤А╤Г" },
        { text: "ЁЯСе ╨Я╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╕╤В╤М╤Б╤П ╨║ ╨╕╨│╤А╨╡" },
      ],
      [
        { text: "ЁЯТб ╨Я╤А╨╡╨┤╨╗╨╛╨╢╨╕╤В╤М ╤Н╨┐╨╕╨╖╨╛╨┤" },
      ],
    ] as Array<Array<{ text: string }>>;

    // Add admin panel button for admins
    if (userId && isAdmin(userId)) {
      baseKeyboard.push([
        { text: "ЁЯСС ╨Р╨┤╨╝╨╕╨╜-╨┐╨░╨╜╨╡╨╗╤М" },
      ]);
    }

    return {
      keyboard: baseKeyboard,
      resize_keyboard: true,
      persistent: true, // ╨Я╨╛╤Б╤В╨╛╤П╨╜╨╜╨░╤П ╨║╨╗╨░╨▓╨╕╨░╤В╤Г╤А╨░
    };
  };

  const mainMenuKeyboard = getMainMenuKeyboard();

  // /start command - with optional deep link parameter
  bot.start(async (ctx) => {
    const startPayload = ctx.startPayload;
    const userId = ctx.from?.id;

    console.log("[Bot] /start command received", { userId, startPayload });

    const welcomeText = `ЁЯОд ╨Ч╨╗╨╛╨▒╨╜╨░╤П ╨╛╨╖╨▓╤Г╤З╨║╨░ - ╤Н╤В╨╛ ╨╕╨│╤А╨░, ╨▓ ╨║╨╛╤В╨╛╤А╨╛╨╣ ╨▓╤Л ╨╛╨╖╨▓╤Г╤З╨╕╨▓╨░╨╡╤В╨╡ ╤Н╨┐╨╕╨╖╨╛╨┤╤Л ╨╕╨╖ ╨║╨╕╨╜╨╛, ╤Б╨╡╤А╨╕╨░╨╗╨╛╨▓, ╨╝╨╡╨╝╨╛╨▓ ╨╕ ╨┐╤А╨╛╤З╨╕╤Е ╤А╨╛╨╗╨╕╨║╨╛╨▓.

ЁЯОо ╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╨║╨╛╨╗╨╕╤З╨╡╤Б╤В╨▓╨╛ ╨╕╨│╤А╨╛╨║╨╛╨▓ - ╨╝╨╛╨╢╨╜╨╛ ╤Б╤Л╨│╤А╨░╤В╤М ╨╛╨┤╨╜╨╛╨╝╤Г ╨╕ ╨╛╨╖╨▓╤Г╤З╨╕╤В╤М ╨▓╤Б╨╡ ╤А╨╡╨┐╨╗╨╕╨║╨╕ ╤Б╨░╨╝╨╛╤Б╤В╨╛╤П╤В╨╡╨╗╤М╨╜╨╛ ╨╕╨╗╨╕ ╨╢╨╡ ╨┐╤А╨╕╨│╨╗╨░╤Б╨╕╤В╤М ╨┤╤А╤Г╨│╨░ ╨╕ ╤Б╤Л╨│╤А╨░╤В╤М ╨▓╨┤╨▓╨╛╨╡╨╝.

ЁЯОм ╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╨║╨░╤В╨╡╨│╨╛╤А╨╕╤О "╨Ъ╨╕╨╜╨╛ ╨╕ ╤Б╨╡╤А╨╕╨░╨╗╤Л", "╨Ь╨╡╨╝╤Л" ╨╕╨╗╨╕ "╨Я╨╛╨╗╨╕╤В╨╕╨║╨░" - ╨▓╨░╨╝ ╤Б╨╗╤Г╤З╨░╨╣╨╜╤Л╨╝ ╨╛╨▒╤А╨░╨╖╨╛╨╝ ╨┐╨╛╨┐╨░╨┤╨╡╤В╤Б╤П ╤Н╨┐╨╕╨╖╨╛╨┤ ╨╕╨╖ ╨▓╤Л╨▒╤А╨░╨╜╨╜╨╛╨│╨╛ ╨╜╨░╨▒╨╛╤А╨░. ╨Ф╨╗╤П ╤В╨╛╨│╨╛, ╤З╤В╨╛╨▒╤Л ╨╛╨╖╨▓╤Г╤З╨╕╤В╤М ╨┤╤А╤Г╨│╨╛╨╣ ╤Н╨┐╨╕╨╖╨╛╨┤ - ╨╖╨░╨║╨╛╨╜╤З╨╕╤В╨╡ ╨╛╨╖╨▓╤Г╤З╨║╤Г ╨╕ ╨╜╨░╤З╨╜╨╕╤В╨╡ ╨╕╨│╤А╤Г ╨╖╨░╨╜╨╛╨▓╨╛.

тЭЧя╕П ╨Ф╨░╨╗╨╡╨╡ ╤А╨╡╨╢╨╕╨╝ - ╨╝╨╛╨╢╨╜╨╛ ╨╛╨╖╨▓╤Г╤З╨╕╨▓╨░╤В╤М ╤Б╨▓╨╛╨▒╨╛╨┤╨╜╨╛ ╨╕╨╗╨╕ ╨╢╨╡ ╨╛╨╖╨▓╤Г╤З╨╕╨▓╨░╤В╤М ╨┐╨╛ ╤Б╨╗╤Г╤З╨░╨╣╨╜╨╛ ╨▓╤Л╨┐╨░╨▓╤И╨╡╨╝╤Г ╨╖╨░╨┤╨░╨╜╨╕╤О.

тЦ╢я╕П ╨Я╤А╨╛╤Б╨╝╨╛╤В╤А╨╕╤В╨╡ ╤Н╨┐╨╕╨╖╨╛╨┤ ╨┐╤А╨╕╨┤╤Г╨╝╨░╨╣╤В╨╡ ╤Б╨▓╨╛╤О ╨▓╨╡╤А╤Б╨╕╤О ╨╛╨╖╨▓╤Г╤З╨║╨╕ ╨╕ ╨╖╨░╨┐╨╕╤И╨╕╤В╨╡ ╨╡╨╡. ╨Ю╨▒╤А╨░╤Й╨░╨╣╤В╨╡ ╨▓╨╜╨╕╨╝╨░╨╜╨╕╨╡ ╨╜╨░ ╨┤╨╗╨╕╤В╨╡╨╗╤М╨╜╨╛╤Б╤В╤М ╨▓╨░╤И╨╡╨╣ ╤А╨╛╨╗╨╕ ╨╕ ╨┐╨╛╨┤╨│╨╛╨╜╤П╨╣╤В╨╡ ╤Б╨▓╨╛╨╕ ╤А╨╡╨┐╨╗╨╕╨║╨╕, ╤З╤В╨╛╨▒╤Л ╨▓╨┐╨╕╤Б╨░╤В╤М╤Б╤П ╨▓ ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕!

тЬЕ ╨Э╨░╤Б╨╗╨░╨╢╨┤╨░╨╣╤В╨╡╤Б╤М ╤А╨╡╨╖╤Г╨╗╤М╤В╨░╤В╨╛╨╝, ╨┤╨░ ╨┐╤А╨╕╨▒╤Г╨┤╨╡╤В ╤Б ╨▓╨░╨╝╨╕ ╨║╤А╨╡╨░╤В╨╕╨▓ ╨╕ ╨╕╤Б╨║╤А╨╛╨╝╨╡╤В╨╜╤Л╨╣ ╤О╨╝╨╛╤А!

тЭдя╕П ╨Ъ╨░╨╢╨┤╤Л╨╣ ╨╕╨│╤А╨╛╨║ ╨╝╨╛╨╢╨╡╤В ╨┤╨╛╨▒╨░╨▓╨╕╤В╤М ╤Б╨▓╨╛╨╣ ╤Н╨┐╨╕╨╖╨╛╨┤ ╨▓ ╨╕╨│╤А╤Г! ╨Э╨░╨╢╨╝╨╕╤В╨╡ ╨║╨╜╨╛╨┐╨║╤Г "╨Я╤А╨╡╨┤╨╗╨╛╨╢╨╕╤В╤М ╤Н╨┐╨╕╨╖╨╛╨┤" ╨╕ ╤Б╨╗╨╡╨┤╤Г╨╣╤В╨╡ ╨╕╨╜╤Б╤В╤А╤Г╨║╤Ж╨╕╨╕.

ЁЯСЗ ╨Ш╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╣╤В╨╡ ╨╝╨╡╨╜╤О ╨▓╨╜╨╕╨╖╤Г ╨┤╨╗╤П ╨╜╨░╨▓╨╕╨│╨░╤Ж╨╕╨╕.`;

    // Send response immediately with persistent keyboard
    try {
      // Check for startapp parameters - these are passed when Mini App opens via link
      // Format: s_sessionId (direct session link) or join_CODE (join by code)
      if (startPayload && startPayload.startsWith("s_")) {
        // Direct session link - just show welcome, Mini App will handle the routing
        const sessionId = startPayload.slice(2); // Remove "s_" prefix
        console.log("[Bot] Direct session link, sessionId:", sessionId);
        
        await ctx.reply(
          `ЁЯОм ╨Ю╤В╨║╤А╤Л╨▓╨░╤О ╨╕╨│╤А╤Г...\n\n` +
          `╨Э╨░╨╢╨╝╨╕╤В╨╡ ╨║╨╜╨╛╨┐╨║╤Г ╨╝╨╡╨╜╤О "ЁЯОн ╨Ш╨│╤А╨░╤В╤М" ╤З╤В╨╛╨▒╤Л ╨╛╤В╨║╤А╤Л╤В╤М ╨┐╤А╨╕╨╗╨╛╨╢╨╡╨╜╨╕╨╡.`,
          { reply_markup: getMainMenuKeyboard(userId) }
        );
      } else if (startPayload && startPayload.startsWith("join_")) {
        const sessionCode = startPayload.slice(5).toUpperCase(); // Remove "join_" prefix
        console.log("[Bot] Join deep link detected, code:", sessionCode);
        
        // Find the session by code
        const allSessions = await prisma.session.findMany({
          where: {
            status: { in: ["lobby", "recording"] },
          },
          include: { participants: true },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        
        const session = allSessions.find(s => 
          s.id.slice(-8).toUpperCase() === sessionCode ||
          s.id.toUpperCase().endsWith(sessionCode.toUpperCase())
        );
        
        if (session) {
          // Send link instead of inline web_app button (iOS bug workaround)
          const joinLink = `https://t.me/${config.botUsername}?startapp=s_${session.id}`;
          console.log("[Bot] Found session, sending link:", session.id);
          
          await ctx.reply(
            `ЁЯОм ╨Т╨░╤Б ╨┐╤А╨╕╨│╨╗╨░╤Б╨╕╨╗╨╕ ╨▓ ╨╕╨│╤А╤Г!\n\n` +
            `╨Ш╨│╤А╨╛╨║╨╛╨▓: ${session.participants.length}/${session.maxPlayers}\n\n` +
            `ЁЯСЙ ╨Э╨░╨╢╨╝╨╕╤В╨╡ ╨╜╨░ ╤Б╤Б╤Л╨╗╨║╤Г ╤З╤В╨╛╨▒╤Л ╨┐╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╕╤В╤М╤Б╤П:\n${joinLink}`,
            { reply_markup: getMainMenuKeyboard(userId) }
          );
        } else {
          // Session not found - show error
          await ctx.reply(
            `тЭМ ╨Ш╨│╤А╨░ ╤Б ╨║╨╛╨┤╨╛╨╝ ${sessionCode} ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╨░ ╨╕╨╗╨╕ ╤Г╨╢╨╡ ╨╖╨░╨║╤А╤Л╤В╨░.\n\n` +
            `╨Я╨╛╨┐╤А╨╛╤Б╨╕╤В╨╡ ╨┤╤А╤Г╨│╨░ ╨┐╤А╨╕╤Б╨╗╨░╤В╤М ╨╜╨╛╨▓╤Л╨╣ ╨║╨╛╨┤.`,
            { reply_markup: getMainMenuKeyboard(userId) }
          );
        }
      } else if (startPayload) {
        // Other deep link - treat as session ID (for result viewing)
        console.log("[Bot] Other deep link:", startPayload);
        
        await ctx.reply(welcomeText, {
          reply_markup: getMainMenuKeyboard(userId),
        });
      } else {
        // Regular start - show menu with admin button if admin
        await ctx.reply(welcomeText, {
          reply_markup: getMainMenuKeyboard(userId),
        });
      }
    } catch (err) {
      console.error("[Bot] Error sending /start response:", err);
      // Don't try to send error message if reply already failed
      return;
    }

    // Notify channel about new user (if not a deep link session join)
    // Do this completely asynchronously after response is sent
    if (!startPayload && userId && config.notifyChannelId) {
      // Use setTimeout to ensure this runs after response is sent
      setTimeout(() => {
        const userName = ctx.from?.first_name || "╨Р╨╜╨╛╨╜╨╕╨╝";
        const userLink = ctx.from?.username ? `@${ctx.from.username}` : `ID: ${userId}`;
        bot.telegram.sendMessage(
          config.notifyChannelId,
          `ЁЯСд ╨Э╨╛╨▓╤Л╨╣ ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М!\n\n${userName} (${userLink})`
        ).catch((err) => {
          // Silently ignore - channel notification is not critical
          console.error("Failed to notify channel:", err.message);
        });
      }, 100);
    }
  });

  // Handle "Join game" button (from text menu)
  bot.hears("ЁЯСе ╨Я╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╕╤В╤М╤Б╤П ╨║ ╨╕╨│╤А╨╡", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    
    console.log("[Bot] Join game button clicked", { userId });

    await botState.setPendingJoin(userId);
    await ctx.reply("ЁЯФС ╨Т╨▓╨╡╨┤╨╕ ╨║╨╛╨┤ ╨╛╤В ╨┤╤А╤Г╨│╨░:", {
      reply_markup: {
        keyboard: [
          [{ text: "тЭМ ╨Ю╤В╨╝╨╡╨╜╨░" }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    });
  });

  // Handle "Join game" inline button (legacy support)
  bot.action("join_game", async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const userId = ctx.from?.id;
      if (!userId) return;
      
      console.log("[Bot] join_game inline button clicked", { userId });

      await botState.setPendingJoin(userId);
      await ctx.reply("ЁЯФС ╨Т╨▓╨╡╨┤╨╕ ╨║╨╛╨┤ ╨╛╤В ╨┤╤А╤Г╨│╨░:", {
        reply_markup: {
          keyboard: [
            [{ text: "тЭМ ╨Ю╤В╨╝╨╡╨╜╨░" }],
          ],
          resize_keyboard: true,
          one_time_keyboard: false,
        },
      });
    } catch (err) {
      console.error("[Bot] Error in join_game handler:", err);
      await ctx.answerCbQuery("╨Я╤А╨╛╨╕╨╖╨╛╤И╨╗╨░ ╨╛╤И╨╕╨▒╨║╨░").catch(() => {});
    }
  });

  // /join command - same as clicking "Join game" button
  bot.command("join", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await botState.setPendingJoin(userId);
    await ctx.reply("ЁЯФС ╨Т╨▓╨╡╨┤╨╕ ╨║╨╛╨┤ ╨╛╤В ╨┤╤А╤Г╨│╨░:", {
      reply_markup: {
        keyboard: [[{ text: "тЭМ ╨Ю╤В╨╝╨╡╨╜╨░" }]],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    });
  });

  // Handle "Start game" button (from text menu)
  // NOTE: Using text link instead of inline web_app button - iOS bug workaround [[memory:13197292]]
  bot.hears("ЁЯОн ╨Э╨░╤З╨░╤В╤М ╨╕╨│╤А╤Г", async (ctx) => {
    const botUsername = config.botUsername || "zlomem_bot";
    // Use ?startapp= to open Mini App correctly on all platforms
    const appLink = `https://t.me/${botUsername}/app`;
    
    await ctx.reply(
      `ЁЯОо ╨Э╨░╨╢╨╝╨╕ ╨╜╨░ ╤Б╤Б╤Л╨╗╨║╤Г ╤З╤В╨╛╨▒╤Л ╨╛╤В╨║╤А╤Л╤В╤М ╨╕╨│╤А╤Г:\n\n${appLink}`,
      {
        reply_markup: getMainMenuKeyboard(ctx.from?.id),
      }
    );
  });

  // Handle "Suggest episode" button (from text menu)
  bot.hears("ЁЯТб ╨Я╤А╨╡╨┤╨╗╨╛╨╢╨╕╤В╤М ╤Н╨┐╨╕╨╖╨╛╨┤", async (ctx) => {
    await ctx.reply(
      `ЁЯТб ╨Я╤А╨╡╨┤╨╗╨╛╨╢╨╕╤В╤М ╤Н╨┐╨╕╨╖╨╛╨┤\n\n` +
      `╨Ф╨╗╤П ╤В╨╛╨│╨╛, ╤З╤В╨╛╨▒╤Л ╨┐╤А╨╡╨┤╨╗╨╛╨╢╨╕╤В╤М ╤Н╨┐╨╕╨╖╨╛╨┤, ╤Б╨║╨╕╨╜╤М╤В╨╡ ╨▓╨╕╨┤╨╡╨╛ ╨╕╨╗╨╕ ╤Б╤Б╤Л╨╗╨║╤Г ╨╜╨░ ╨╢╨╡╨╗╨░╨╡╨╝╤Л╨╣ ╤Д╤А╨░╨│╨╝╨╡╨╜╤В ` +
      `╨╕ ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕ ╤А╨╡╨┐╨╗╨╕╨║, ╨║╨╛╤В╨╛╤А╤Л╨╡ ╨▓╤Л ╤Е╨╛╤В╨╡╨╗╨╕ ╨▒╤Л ╨╛╨╖╨▓╤Г╤З╨╕╤В╤М ╨╜╨░ ╨┤╨░╨╜╨╜╤Л╨╣ ╤В╨╡╨╗╨╡╨│╤А╨░╨╝:\n\n` +
      `ЁЯСЙ https://t.me/skameeckaa`,
      {
        reply_markup: getMainMenuKeyboard(ctx.from?.id), // ╨Т╨╡╤А╨╜╤Г╤В╤М ╨│╨╗╨░╨▓╨╜╨╛╨╡ ╨╝╨╡╨╜╤О
      }
    );
  });

  // Handle "Suggest episode" inline button (legacy support)
  bot.action("suggest_episode", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `ЁЯТб ╨Я╤А╨╡╨┤╨╗╨╛╨╢╨╕╤В╤М ╤Н╨┐╨╕╨╖╨╛╨┤\n\n` +
      `╨Ф╨╗╤П ╤В╨╛╨│╨╛, ╤З╤В╨╛╨▒╤Л ╨┐╤А╨╡╨┤╨╗╨╛╨╢╨╕╤В╤М ╤Н╨┐╨╕╨╖╨╛╨┤, ╤Б╨║╨╕╨╜╤М╤В╨╡ ╨▓╨╕╨┤╨╡╨╛ ╨╕╨╗╨╕ ╤Б╤Б╤Л╨╗╨║╤Г ╨╜╨░ ╨╢╨╡╨╗╨░╨╡╨╝╤Л╨╣ ╤Д╤А╨░╨│╨╝╨╡╨╜╤В ` +
      `╨╕ ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕ ╤А╨╡╨┐╨╗╨╕╨║, ╨║╨╛╤В╨╛╤А╤Л╨╡ ╨▓╤Л ╤Е╨╛╤В╨╡╨╗╨╕ ╨▒╤Л ╨╛╨╖╨▓╤Г╤З╨╕╤В╤М ╨╜╨░ ╨┤╨░╨╜╨╜╤Л╨╣ ╤В╨╡╨╗╨╡╨│╤А╨░╨╝:\n\n` +
      `ЁЯСЙ https://t.me/skameeckaa`,
      {
        reply_markup: getMainMenuKeyboard(ctx.from?.id), // ╨Т╨╡╤А╨╜╤Г╤В╤М ╨│╨╗╨░╨▓╨╜╨╛╨╡ ╨╝╨╡╨╜╤О
      }
    );
  });

  // /help command
  bot.help(async (ctx) => {
    const isUserAdmin = isAdmin(ctx.from?.id ?? 0);
    
    let helpText = "ЁЯОм DubDub тАФ ╨╕╨│╤А╨░ ╨┤╨╗╤П ╨╛╨╖╨▓╤Г╤З╨║╨╕ ╨▓╨╕╨┤╨╡╨╛\n\n" +
      "1. ╨б╨╛╨╖╨┤╨░╨╣ ╤Б╨╡╤Б╤Б╨╕╤О ╨╕ ╨┐╤А╨╕╨│╨╗╨░╤Б╨╕ ╨┤╤А╤Г╨╖╨╡╨╣\n" +
      "2. ╨Ъ╨░╨╢╨┤╤Л╨╣ ╨╕╨│╤А╨╛╨║ ╨╖╨░╨┐╨╕╤Б╤Л╨▓╨░╨╡╤В ╤А╨╡╨┐╨╗╨╕╨║╤Г\n" +
      "3. ╨б╨╗╨╡╨┤╤Г╤О╤Й╨╕╨╣ ╨╕╨│╤А╨╛╨║ ╤Б╨╗╤Л╤И╨╕╤В ╤В╨╛╨╗╤М╨║╨╛ ╤З╨░╤Б╤В╤М ╨┐╤А╨╡╨┤╤Л╨┤╤Г╤Й╨╡╨╣ ╨╖╨░╨┐╨╕╤Б╨╕\n" +
      "4. ╨Т ╨║╨╛╨╜╤Ж╨╡ ╨┐╨╛╨╗╤Г╤З╨░╨╡╤В╨╡ ╤Б╨╝╨╡╤И╨╜╨╛╨╡ ╨▓╨╕╨┤╨╡╨╛!\n\n";

    if (isUserAdmin) {
      helpText += "ЁЯСС ╨Р╨┤╨╝╨╕╨╜-╨║╨╛╨╝╨░╨╜╨┤╤Л:\n" +
        "/scenes тАФ ╤Б╨┐╨╕╤Б╨╛╨║ ╤Б╤Ж╨╡╨╜\n" +
        "/edit_cues тАФ ╤А╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╤В╤М ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕\n" +
        "/stats тАФ ╤Б╤В╨░╤В╨╕╤Б╤В╨╕╨║╨░\n" +
        "╨Ю╤В╨┐╤А╨░╨▓╤М ╨▓╨╕╨┤╨╡╨╛ тАФ ╨┤╨╛╨▒╨░╨▓╨╕╤В╤М ╨╜╨╛╨▓╤Г╤О ╤Б╤Ж╨╡╨╜╤Г\n\n";
    }

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: "ЁЯОн ╨Ю╤В╨║╤А╤Л╤В╤М DubDub",
            web_app: { url: config.webappUrl },
          },
        ],
      ],
    };

    // Add admin panel button for admins
    if (isUserAdmin) {
      keyboard.inline_keyboard.push([
        {
          text: "ЁЯСС ╨Р╨┤╨╝╨╕╨╜-╨┐╨░╨╜╨╡╨╗╤М",
          web_app: { url: `${config.webappUrl}/admin/scenes` },
        },
      ]);
    }

    await ctx.reply(helpText + "╨Э╨░╨╢╨╝╨╕ ╨║╨╜╨╛╨┐╨║╤Г ╨╜╨╕╨╢╨╡, ╤З╤В╨╛╨▒╤Л ╨╜╨░╤З╨░╤В╤М ЁЯСЗ", {
      reply_markup: keyboard,
    });
  });

  // /scenes - ╤Б╨┐╨╕╤Б╨╛╨║ ╤Б╤Ж╨╡╨╜ (╤В╨╛╨╗╤М╨║╨╛ ╨░╨┤╨╝╨╕╨╜)
  bot.command("scenes", async (ctx) => {
    if (!isAdmin(ctx.from?.id ?? 0)) {
      return ctx.reply("тЫФ ╨Э╨╡╤В ╨┤╨╛╤Б╤В╤Г╨┐╨░");
    }

    const scenes = await prisma.scene.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    if (scenes.length === 0) {
      return ctx.reply("╨б╤Ж╨╡╨╜ ╨┐╨╛╨║╨░ ╨╜╨╡╤В. ╨Ю╤В╨┐╤А╨░╨▓╤М ╨▓╨╕╨┤╨╡╨╛, ╤З╤В╨╛╨▒╤Л ╨┤╨╛╨▒╨░╨▓╨╕╤В╤М.");
    }

    const list = scenes.map((s, i) => {
      const catLabel = CATEGORY_LABELS[s.category as SceneCategory] || s.category;
      return `${i + 1}. ${s.title}\n   ${catLabel}\n   ЁЯУ╣ ${s.durationSec}s, ${s.rolesCount} ╤А╨╡╨┐╨╗╨╕╨║\n   ЁЯЖФ ${s.id}`;
    }).join("\n\n");

    await ctx.reply(`ЁЯУЛ ╨б╤Ж╨╡╨╜╤Л (${scenes.length}):\n\n${list}`);
  });

  // /stats - ╤Б╤В╨░╤В╨╕╤Б╤В╨╕╨║╨░ (╤В╨╛╨╗╤М╨║╨╛ ╨░╨┤╨╝╨╕╨╜)
  bot.command("stats", async (ctx) => {
    if (!isAdmin(ctx.from?.id ?? 0)) {
      return ctx.reply("тЫФ ╨Э╨╡╤В ╨┤╨╛╤Б╤В╤Г╨┐╨░");
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalUsers, totalSessions, todaySessions, completedSessions, scenesCount] = await Promise.all([
      prisma.participant.groupBy({ by: ["tgUserId"] }).then(r => r.length),
      prisma.session.count(),
      prisma.session.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.session.count({ where: { status: "ready" } }),
      prisma.scene.count(),
    ]);

    const conversionRate = totalSessions > 0 
      ? Math.round((completedSessions / totalSessions) * 100) 
      : 0;

    await ctx.reply(
      `ЁЯУК ╨б╤В╨░╤В╨╕╤Б╤В╨╕╨║╨░ DubDub\n\n` +
      `ЁЯСе ╨Ш╨│╤А╨╛╨║╨╛╨▓: ${totalUsers}\n` +
      `ЁЯОм ╨Т╤Б╨╡╨│╨╛ ╤Б╨╡╤Б╤Б╨╕╨╣: ${totalSessions}\n` +
      `ЁЯУЕ ╨б╨╡╨│╨╛╨┤╨╜╤П: ${todaySessions}\n` +
      `тЬЕ ╨Ч╨░╨▓╨╡╤А╤И╨╡╨╜╨╛: ${completedSessions} (${conversionRate}%)\n` +
      `ЁЯОе ╨б╤Ж╨╡╨╜: ${scenesCount}`
    );
  });

  // /cancel - ╨╛╤В╨╝╨╡╨╜╨░ ╤В╨╡╨║╤Г╤Й╨╡╨╣ ╨╛╨┐╨╡╤А╨░╤Ж╨╕╨╕
  bot.command("cancel", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
      const [hasPendingScene, hasPendingEdit, hasPendingJoin] = await Promise.all([
        botState.getPendingScene(userId),
        botState.getPendingEdit(userId),
        botState.getPendingJoin(userId),
      ]);
      const hadPending = hasPendingScene !== null || hasPendingEdit !== null || hasPendingJoin;
      
      await botState.clearAll(userId);
      
      if (hadPending) {
        await ctx.reply("тЭМ ╨Ю╨┐╨╡╤А╨░╤Ж╨╕╤П ╨╛╤В╨╝╨╡╨╜╨╡╨╜╨░", {
          reply_markup: getMainMenuKeyboard(ctx.from?.id), // ╨Т╤Б╨╡╨│╨┤╨░ ╨▓╨╛╨╖╨▓╤А╨░╤Й╨░╨╡╨╝ ╨│╨╗╨░╨▓╨╜╨╛╨╡ ╨╝╨╡╨╜╤О
        });
      } else {
        // ╨Ф╨░╨╢╨╡ ╨╡╤Б╨╗╨╕ ╨╜╨╡╤В ╨░╨║╤В╨╕╨▓╨╜╤Л╤Е ╨╛╨┐╨╡╤А╨░╤Ж╨╕╨╣, ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╨╝ ╨│╨╗╨░╨▓╨╜╨╛╨╡ ╨╝╨╡╨╜╤О
        await ctx.reply("╨У╨╗╨░╨▓╨╜╨╛╨╡ ╨╝╨╡╨╜╤О", {
          reply_markup: getMainMenuKeyboard(ctx.from?.id),
        });
      }
    }
  });

  // Handle "Admin panel" button
  bot.hears("ЁЯСС ╨Р╨┤╨╝╨╕╨╜-╨┐╨░╨╜╨╡╨╗╤М", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return ctx.reply("тЫФ ╨Э╨╡╤В ╨┤╨╛╤Б╤В╤Г╨┐╨░", {
        reply_markup: getMainMenuKeyboard(userId),
      });
    }

    await ctx.reply("╨Ю╤В╨║╤А╤Л╨▓╨░╤О ╨░╨┤╨╝╨╕╨╜-╨┐╨░╨╜╨╡╨╗╤М...", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "ЁЯСС ╨Р╨┤╨╝╨╕╨╜-╨┐╨░╨╜╨╡╨╗╤М",
              web_app: { url: `${config.webappUrl}/admin/scenes` },
            },
          ],
        ],
      },
    });
  });

  // /edit_cues - ╤А╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╜╨╕╨╡ ╤В╨░╨╣╨╝╨╕╨╜╨│╨╛╨▓ ╤Б╤Ж╨╡╨╜╤Л (╤В╨╛╨╗╤М╨║╨╛ ╨░╨┤╨╝╨╕╨╜)
  bot.command("edit_cues", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return ctx.reply("тЫФ ╨Э╨╡╤В ╨┤╨╛╤Б╤В╤Г╨┐╨░");
    }

    // ╨Я╨╛╨╗╤Г╤З╨░╨╡╨╝ ID ╤Б╤Ж╨╡╨╜╤Л ╨╕╨╖ ╨░╤А╨│╤Г╨╝╨╡╨╜╤В╨░ ╨╕╨╗╨╕ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╨╝ ╤Б╨┐╨╕╤Б╨╛╨║
    const args = ctx.message.text.split(" ").slice(1);
    
    if (args.length === 0) {
      // ╨Я╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╨╝ ╤Б╨┐╨╕╤Б╨╛╨║ ╤Б╤Ж╨╡╨╜ ╨┤╨╗╤П ╨▓╤Л╨▒╨╛╤А╨░
      const scenes = await prisma.scene.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      if (scenes.length === 0) {
        return ctx.reply("╨б╤Ж╨╡╨╜ ╨┐╨╛╨║╨░ ╨╜╨╡╤В.");
      }

      const list = scenes.map((s, i) => {
        const cues = JSON.parse(s.cueJson) as Array<{ roleIndex: number; startSec: number; durationSec: number }>;
        const cueStr = cues.map((c, j) => `${c.startSec}-${c.startSec + c.durationSec}`).join(", ");
        return `${i + 1}. *${s.title}*\n   ╨в╨░╨╣╨╝╨╕╨╜╨│╨╕: \`${cueStr}\`\n   ID: \`${s.id}\``;
      }).join("\n\n");

      await botState.setPendingEdit(userId, {
        userId,
        sceneId: "",
        step: "awaiting_sceneId",
      });

      await ctx.reply(
        `ЁЯОм ╨Т╤Л╨▒╨╡╤А╨╕ ╤Б╤Ж╨╡╨╜╤Г ╨┤╨╗╤П ╤А╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╜╨╕╤П:\n\n${list}\n\n╨Ю╤В╨┐╤А╨░╨▓╤М ID ╤Б╤Ж╨╡╨╜╤Л:`,
        { 
          parse_mode: "Markdown",
          reply_markup: {
            keyboard: [[{ text: "тЭМ ╨Ю╤В╨╝╨╡╨╜╨░" }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
      return;
    }

    // ID ╤Б╤Ж╨╡╨╜╤Л ╨┐╨╡╤А╨╡╨┤╨░╨╜ ╨▓ ╨║╨╛╨╝╨░╨╜╨┤╨╡
    const sceneId = args[0]!;
    await startCueEditing(ctx, userId, sceneId);
  });

  // Helper: ╨╜╨░╤З╨░╤В╤М ╤А╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╜╨╕╨╡ cues
  async function startCueEditing(ctx: Context, userId: number, sceneId: string) {
    const scene = await prisma.scene.findUnique({ where: { id: sceneId } });

    if (!scene) {
      await ctx.reply(`тЭМ ╨б╤Ж╨╡╨╜╨░ "${sceneId}" ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╨░`);
      return;
    }

    const fps = scene.fps;
    const totalFrames = Math.round(scene.durationSec * fps);
    const rawCues = JSON.parse(scene.cueJson) as any[];
    
    // Format cues for display (handle both old and new formats)
    const cueStr = rawCues.map(c => {
      if ('startFrame' in c) {
        return `${c.startFrame}-${c.startFrame + c.durationFrames}`;
      }
      // Old format - convert to frames
      const startFrame = Math.round(c.startSec * fps);
      const endFrame = Math.round((c.startSec + c.durationSec) * fps);
      return `${startFrame}-${endFrame}`;
    }).join(", ");

    await botState.setPendingEdit(userId, {
      userId,
      sceneId: scene.id,
      step: "awaiting_new_cues",
      scene: {
        id: scene.id,
        title: scene.title,
        duration: scene.durationSec,
        fps,
        totalFrames,
      },
    });

    await ctx.reply(
      `ЁЯОм ╨а╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╜╨╕╨╡: *${scene.title}*\n\n` +
      `тП▒ ╨Ф╨╗╨╕╤В╨╡╨╗╤М╨╜╨╛╤Б╤В╤М: ${scene.durationSec}s\n` +
      `ЁЯОЮ FPS: ${fps}\n` +
      `ЁЯУК ╨Т╤Б╨╡╨│╨╛ ╨║╨░╨┤╤А╨╛╨▓: ${totalFrames}\n` +
      `ЁЯУН ╨в╨╡╨║╤Г╤Й╨╕╨╡ ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕ (╨▓ ╨║╨░╨┤╤А╨░╤Е): \`${cueStr}\`\n\n` +
      `╨Т╨▓╨╡╨┤╨╕ ╨╜╨╛╨▓╤Л╨╡ ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕ ╨Т ╨Ъ╨Р╨Ф╨а╨Р╨е:\n` +
      `\`0-125, 150-275\``,
      { 
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "тЭМ ╨Ю╤В╨╝╨╡╨╜╨░" }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
  }

  // ╨Ъ╨╛╨╝╨░╨╜╨┤╨░ ╨┤╨╗╤П ╨╖╨░╨│╤А╤Г╨╖╨║╨╕ ╨▓╨╕╨┤╨╡╨╛ ╨┐╨╛ URL
  bot.command("upload_url", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return ctx.reply("тЫФ ╨Э╨╡╤В ╨┤╨╛╤Б╤В╤Г╨┐╨░");
    }

    const messageText = ctx.message.text;
    if (!messageText) {
      await ctx.reply("тЭМ ╨Ю╤И╨╕╨▒╨║╨░: ╨┐╤Г╤Б╤В╨╛╨╡ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╡");
      return;
    }

    const args = messageText.split(" ").slice(1);
    if (args.length === 0) {
      await ctx.reply(
        `ЁЯФЧ ╨Ч╨░╨│╤А╤Г╨╖╨║╨░ ╨▓╨╕╨┤╨╡╨╛ ╨┐╨╛ ╤Б╤Б╤Л╨╗╨║╨╡\n\n` +
        `╨Ш╤Б╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╨╜╨╕╨╡: /upload_url <URL>\n\n` +
        `╨Я╤А╨╕╨╝╨╡╤А:\n` +
        `/upload_url https://example.com/video.mp4\n\n` +
        `╨Ш╨╗╨╕ ╨┐╤А╨╛╤Б╤В╨╛ ╨╛╤В╨┐╤А╨░╨▓╤М ╤Б╤Б╤Л╨╗╨║╤Г ╨▒╨╛╤В╤Г, ╨╕ ╨╛╨╜ ╨┐╤А╨╡╨┤╨╗╨╛╨╢╨╕╤В ╨╖╨░╨│╤А╤Г╨╖╨╕╤В╤М.`
      );
      return;
    }

    const fileUrl = args[0];
    if (!fileUrl || !isValidUrl(fileUrl)) {
      await ctx.reply("тЭМ ╨Э╨╡╨▓╨╡╤А╨╜╤Л╨╣ URL. ╨Ш╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╣ http:// ╨╕╨╗╨╕ https://");
      return;
    }

    await handleVideoUrl(ctx, userId, fileUrl);
  });

  // ╨Ю╨▒╤А╨░╨▒╨╛╤В╨║╨░ callback ╨┤╨╗╤П ╨╖╨░╨│╤А╤Г╨╖╨║╨╕ ╨┐╨╛ URL
  bot.action(/^upload_url:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return ctx.answerCbQuery("тЫФ ╨Э╨╡╤В ╨┤╨╛╤Б╤В╤Г╨┐╨░");
    }

    await ctx.answerCbQuery();
    const matchResult = ctx.match;
    if (!matchResult || !matchResult[1]) {
      await ctx.reply("тЭМ ╨Ю╤И╨╕╨▒╨║╨░: ╨╜╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨┐╨╛╨╗╤Г╤З╨╕╤В╤М URL");
      return;
    }

    const fileUrl = decodeURIComponent(matchResult[1]);
    await handleVideoUrl(ctx, userId, fileUrl);
  });

  // Helper: ╨╛╨▒╤А╨░╨▒╨╛╤В╨║╨░ ╨╖╨░╨│╤А╤Г╨╖╨║╨╕ ╨▓╨╕╨┤╨╡╨╛ ╨┐╨╛ URL
  async function handleVideoUrl(ctx: Context, userId: number, fileUrl: string) {
    let tmpPath: string | null = null;
    try {
      await ctx.reply("тП│ ╨б╨║╨░╤З╨╕╨▓╨░╤О ╨▓╨╕╨┤╨╡╨╛ ╨┐╨╛ ╤Б╤Б╤Л╨╗╨║╨╡...");

      // ╨б╨║╨░╤З╨╕╨▓╨░╨╡╨╝ ╤Д╨░╨╣╨╗ ╨┐╨╛ URL
      const result = await downloadFileFromUrl(fileUrl);
      tmpPath = result.path;
      const buffer = result.buffer;
      const fileSizeMb = buffer.length / (1024 * 1024);
      
      if (buffer.length === 0) {
        throw new Error("Downloaded file is empty");
      }

      console.log(`[Bot] File downloaded successfully: ${fileSizeMb.toFixed(2)} MB, path: ${tmpPath}`);
      
      await ctx.reply(`ЁЯУе ╨д╨░╨╣╨╗ ╤Б╨║╨░╤З╨░╨╜ (${fileSizeMb.toFixed(2)} MB). ╨Р╨╜╨░╨╗╨╕╨╖╨╕╤А╤Г╤О ╨▓╨╕╨┤╨╡╨╛...`);

      try {
        // ╨Я╨╛╨╗╤Г╤З╨░╨╡╨╝ ╨╕╨╜╤Д╨╛╤А╨╝╨░╤Ж╨╕╤О ╨╛ ╨▓╨╕╨┤╨╡╨╛
        const { duration, fps } = await getVideoInfo(tmpPath);
        const totalFrames = Math.round(duration * fps);
        
        console.log(`[Bot] Video info extracted: duration=${duration}s, fps=${fps}, frames=${totalFrames}`);
        
        // ╨г╨┤╨░╨╗╤П╨╡╨╝ ╨▓╤А╨╡╨╝╨╡╨╜╨╜╤Л╨╣ ╤Д╨░╨╣╨╗ (╨╛╨╜ ╨▒╨╛╨╗╤М╤И╨╡ ╨╜╨╡ ╨╜╤Г╨╢╨╡╨╜, ╤В.╨║. ╨▒╤Г╨┤╨╡╨╝ ╤Б╨║╨░╤З╨╕╨▓╨░╤В╤М ╨╖╨░╨╜╨╛╨▓╨╛ ╨┐╤А╨╕ ╤Б╨╛╤Е╤А╨░╨╜╨╡╨╜╨╕╨╕)
        await unlink(tmpPath).catch(() => {});
        tmpPath = null;

        // ╨б╨╛╤Е╤А╨░╨╜╤П╨╡╨╝ ╤Б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╡ (╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╨╝ fileUrl ╨▓╨╝╨╡╤Б╤В╨╛ fileId)
        await botState.setPendingScene(userId, {
          userId,
          fileUrl, // ╨б╨╛╤Е╤А╨░╨╜╤П╨╡╨╝ URL ╨┤╨╗╤П ╨┐╨╛╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╡╨│╨╛ ╤Б╨║╨░╤З╨╕╨▓╨░╨╜╨╕╤П
          duration: Math.round(duration * 10) / 10,
          fps,
          totalFrames,
          step: "awaiting_title",
        });

        await ctx.reply(
          `тЬЕ ╨Т╨╕╨┤╨╡╨╛ ╨╛╨▒╤А╨░╨▒╨╛╤В╨░╨╜╨╛!\n\n` +
          `ЁЯУж ╨а╨░╨╖╨╝╨╡╤А: ${fileSizeMb.toFixed(2)} MB\n` +
          `тП▒ ╨Ф╨╗╨╕╤В╨╡╨╗╤М╨╜╨╛╤Б╤В╤М: ${duration.toFixed(1)} ╤Б╨╡╨║\n` +
          `ЁЯОЮ FPS: ${fps.toFixed(2)}\n` +
          `ЁЯУК ╨Т╤Б╨╡╨│╨╛ ╨║╨░╨┤╤А╨╛╨▓: ${totalFrames}\n\n` +
          `╨Т╨▓╨╡╨┤╨╕ ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡ ╤Б╤Ж╨╡╨╜╤Л:`,
          {
            reply_markup: {
              keyboard: [[{ text: "тЭМ ╨Ю╤В╨╝╨╡╨╜╨░" }]],
              resize_keyboard: true,
              one_time_keyboard: false,
            },
          }
        );
      } catch (infoErr: any) {
        console.error("[Bot] Video info extraction error:", infoErr);
        const errorMsg = infoErr.message || String(infoErr);
        
        let userMsg = "тЭМ ╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨╛╨▒╤А╨░╨▒╨╛╤В╨░╤В╤М ╨▓╨╕╨┤╨╡╨╛.\n\n";
        
        if (errorMsg.includes("ffprobe failed")) {
          userMsg += `тЪая╕П ╨д╨░╨╣╨╗ ╨╜╨╡ ╤П╨▓╨╗╤П╨╡╤В╤Б╤П ╨▓╨░╨╗╨╕╨┤╨╜╤Л╨╝ ╨▓╨╕╨┤╨╡╨╛ ╨╕╨╗╨╕ ╨┐╨╛╨▓╤А╨╡╨╢╨┤╨╡╨╜.\n\n`;
          userMsg += `╨Я╤А╨╛╨▓╨╡╤А╤М:\n`;
          userMsg += `тАв ╨д╨░╨╣╨╗ ╨▓ ╤Д╨╛╤А╨╝╨░╤В╨╡ MP4, AVI, MOV ╨╕ ╤В.╨┤.\n`;
          userMsg += `тАв ╨д╨░╨╣╨╗ ╨╜╨╡ ╨┐╨╛╨▓╤А╨╡╨╢╨┤╨╡╨╜\n`;
          userMsg += `тАв ╨д╨░╨╣╨╗ ╤Б╨╛╨┤╨╡╤А╨╢╨╕╤В ╨▓╨╕╨┤╨╡╨╛ ╨┐╨╛╤В╨╛╨║\n`;
        } else if (errorMsg.includes("File not found")) {
          userMsg += `тЪая╕П ╨д╨░╨╣╨╗ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜ ╨┐╨╛╤Б╨╗╨╡ ╤Б╨║╨░╤З╨╕╨▓╨░╨╜╨╕╤П.`;
        } else if (errorMsg.includes("Invalid video duration")) {
          userMsg += `тЪая╕П ╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨╛╨┐╤А╨╡╨┤╨╡╨╗╨╕╤В╤М ╨┤╨╗╨╕╤В╨╡╨╗╤М╨╜╨╛╤Б╤В╤М ╨▓╨╕╨┤╨╡╨╛.\n`;
          userMsg += `╨Т╨╛╨╖╨╝╨╛╨╢╨╜╨╛, ╤Д╨░╨╣╨╗ ╨╜╨╡ ╤П╨▓╨╗╤П╨╡╤В╤Б╤П ╨▓╨░╨╗╨╕╨┤╨╜╤Л╨╝ ╨▓╨╕╨┤╨╡╨╛.`;
        } else {
          userMsg += `╨Ф╨╡╤В╨░╨╗╨╕: ${errorMsg.substring(0, 200)}`;
        }
        
        await ctx.reply(userMsg);
        throw infoErr;
      }
    } catch (err: any) {
      console.error("[Bot] Video URL download error:", err);
      
      // ╨г╨┤╨░╨╗╤П╨╡╨╝ ╨▓╤А╨╡╨╝╨╡╨╜╨╜╤Л╨╣ ╤Д╨░╨╣╨╗ ╨┐╤А╨╕ ╨╛╤И╨╕╨▒╨║╨╡
      if (tmpPath) {
        await unlink(tmpPath).catch(() => {});
      }
      
      const errorMsg = err.message || String(err);
      let userMsg = "тЭМ ╨Ю╤И╨╕╨▒╨║╨░ ╨╖╨░╨│╤А╤Г╨╖╨║╨╕ ╨▓╨╕╨┤╨╡╨╛ ╨┐╨╛ ╤Б╤Б╤Л╨╗╨║╨╡.";
      
      if (errorMsg.includes("Invalid URL")) {
        userMsg += "\n\nтЪая╕П ╨Э╨╡╨▓╨╡╤А╨╜╤Л╨╣ ╤Д╨╛╤А╨╝╨░╤В URL.";
      } else if (errorMsg.includes("404") || errorMsg.includes("Not Found")) {
        userMsg += "\n\nтЪая╕П ╨д╨░╨╣╨╗ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜ ╨┐╨╛ ╤Н╤В╨╛╨╣ ╤Б╤Б╤Л╨╗╨║╨╡.";
      } else if (errorMsg.includes("403") || errorMsg.includes("Forbidden")) {
        userMsg += "\n\nтЪая╕П ╨Э╨╡╤В ╨┤╨╛╤Б╤В╤Г╨┐╨░ ╨║ ╤Д╨░╨╣╨╗╤Г ╨┐╨╛ ╤Н╤В╨╛╨╣ ╤Б╤Б╤Л╨╗╨║╨╡.";
      } else if (errorMsg.includes("ffprobe") || errorMsg.includes("Invalid video")) {
        // ╨г╨╢╨╡ ╨╛╨▒╤А╨░╨▒╨╛╤В╨░╨╜╨╛ ╨▓╤Л╤И╨╡
        return;
      } else {
        userMsg += `\n\n╨Ф╨╡╤В╨░╨╗╨╕: ${errorMsg.substring(0, 200)}`;
      }
      
      await ctx.reply(userMsg);
    }
  }

  // ╨Ю╨▒╤А╨░╨▒╨╛╤В╨║╨░ ╨▓╨╕╨┤╨╡╨╛ ╨╛╤В ╨░╨┤╨╝╨╕╨╜╨░
  bot.on(message("video"), async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return; // ╨Ш╨│╨╜╨╛╤А╨╕╤А╤Г╨╡╨╝ ╨▓╨╕╨┤╨╡╨╛ ╨╛╤В ╨╜╨╡-╨░╨┤╨╝╨╕╨╜╨╛╨▓
    }

    const video = ctx.message.video;
    
    // ╨Я╤А╨╛╨▓╨╡╤А╨║╨░ ╤А╨░╨╖╨╝╨╡╤А╨░ ╤Д╨░╨╣╨╗╨░ (Telegram ╨╛╨│╤А╨░╨╜╨╕╤З╨╕╨▓╨░╨╡╤В ╨┤╨╛ ~20MB ╨┤╨╗╤П ╨┐╤А╤П╨╝╨╛╨│╨╛ ╤Б╨║╨░╤З╨╕╨▓╨░╨╜╨╕╤П)
    const fileSizeMb = (video.file_size || 0) / (1024 * 1024);
    if (fileSizeMb > 50) {
      await ctx.reply(
        `тЭМ ╨Т╨╕╨┤╨╡╨╛ ╤Б╨╗╨╕╤И╨║╨╛╨╝ ╨▒╨╛╨╗╤М╤И╨╛╨╡ (${fileSizeMb.toFixed(1)} MB).\n\n` +
        `Telegram ╨╛╨│╤А╨░╨╜╨╕╤З╨╕╨▓╨░╨╡╤В ╤А╨░╨╖╨╝╨╡╤А ╤Д╨░╨╣╨╗╨╛╨▓ ╨┤╨╗╤П ╨┐╤А╤П╨╝╨╛╨│╨╛ ╤Б╨║╨░╤З╨╕╨▓╨░╨╜╨╕╤П.\n` +
        `╨Я╨╛╨┐╤А╨╛╨▒╤Г╨╣ ╤Б╨╢╨░╤В╤М ╨▓╨╕╨┤╨╡╨╛ ╨╕╨╗╨╕ ╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╣ ╤Д╨░╨╣╨╗ ╨┤╨╛ 50 MB.`
      );
      return;
    }
    
    try {
      await ctx.reply("тП│ ╨Ю╨▒╤А╨░╨▒╨░╤В╤Л╨▓╨░╤О ╨▓╨╕╨┤╨╡╨╛...");

      // ╨б╨║╨░╤З╨╕╨▓╨░╨╡╨╝ ╨╕ ╨┐╨╛╨╗╤Г╤З╨░╨╡╨╝ ╨╕╨╜╤Д╨╛╤А╨╝╨░╤Ж╨╕╤О
      let tmpPath: string;
      let buffer: Buffer;
      
      try {
        const result = await downloadTelegramFile(bot, video.file_id);
        tmpPath = result.path;
        buffer = result.buffer;
      } catch (downloadErr: any) {
        console.error("Download error:", downloadErr);
        
        // ╨Х╤Б╨╗╨╕ ╨╛╤И╨╕╨▒╨║╨░ "file is too big", ╨┐╨╛╨┐╤А╨╛╨▒╤Г╨╡╨╝ ╤З╨╡╤А╨╡╨╖ ╤Д╨░╨╣╨╗ ╨╜╨░╨┐╤А╤П╨╝╤Г╤О
        if (downloadErr.response?.error_code === 400 && downloadErr.description?.includes("too big")) {
          await ctx.reply(
            `тЭМ ╨Т╨╕╨┤╨╡╨╛ ╤Б╨╗╨╕╤И╨║╨╛╨╝ ╨▒╨╛╨╗╤М╤И╨╛╨╡ ╨┤╨╗╤П ╤Б╨║╨░╤З╨╕╨▓╨░╨╜╨╕╤П ╤З╨╡╤А╨╡╨╖ Telegram.\n\n` +
            `ЁЯУж ╨а╨░╨╖╨╝╨╡╤А: ${fileSizeMb.toFixed(1)} MB\n\n` +
            `ЁЯТб ╨а╨╡╤И╨╡╨╜╨╕╤П:\n` +
            `1. ╨б╨╢╨░╤В╤М ╨▓╨╕╨┤╨╡╨╛ ╨┐╨╡╤А╨╡╨┤ ╨╛╤В╨┐╤А╨░╨▓╨║╨╛╨╣\n` +
            `2. ╨Ш╤Б╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╤М ╨▓╨╕╨┤╨╡╨╛ ╨┤╨╛ 20-30 MB\n` +
            `3. ╨Ч╨░╨│╤А╤Г╨╖╨╕╤В╤М ╨╜╨░╨┐╤А╤П╨╝╤Г╤О ╨╜╨░ ╤Б╨╡╤А╨▓╨╡╤А ╤З╨╡╤А╨╡╨╖ SCP/FTP`
          );
          return;
        }
        throw downloadErr;
      }

      try {
        const { duration, fps } = await getVideoInfo(tmpPath);
        const totalFrames = Math.round(duration * fps);
        
        // ╨г╨┤╨░╨╗╤П╨╡╨╝ ╨▓╤А╨╡╨╝╨╡╨╜╨╜╤Л╨╣ ╤Д╨░╨╣╨╗
        await unlink(tmpPath).catch(() => {});

        // ╨б╨╛╤Е╤А╨░╨╜╤П╨╡╨╝ ╤Б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╡
        await botState.setPendingScene(userId, {
          userId,
          fileId: video.file_id,
          duration: Math.round(duration * 10) / 10,
          fps,
          totalFrames,
          step: "awaiting_title",
        });

        await ctx.reply(
          `ЁЯУ╣ ╨Т╨╕╨┤╨╡╨╛ ╨┐╨╛╨╗╤Г╤З╨╡╨╜╨╛!\n` +
          `тП▒ ╨Ф╨╗╨╕╤В╨╡╨╗╤М╨╜╨╛╤Б╤В╤М: ${duration.toFixed(1)} ╤Б╨╡╨║\n` +
          `ЁЯОЮ FPS: ${fps}\n` +
          `ЁЯУК ╨Т╤Б╨╡╨│╨╛ ╨║╨░╨┤╤А╨╛╨▓: ${totalFrames}\n\n` +
          `╨Т╨▓╨╡╨┤╨╕ ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡ ╤Б╤Ж╨╡╨╜╤Л:`,
          {
            reply_markup: {
              keyboard: [[{ text: "тЭМ ╨Ю╤В╨╝╨╡╨╜╨░" }]],
              resize_keyboard: true,
              one_time_keyboard: false,
            },
          }
        );
      } catch (infoErr) {
        await unlink(tmpPath).catch(() => {});
        throw infoErr;
      }
    } catch (err: any) {
      console.error("Video processing error:", err);
      const errorMsg = err.message || String(err);
      
      let userMsg = "тЭМ ╨Ю╤И╨╕╨▒╨║╨░ ╨╛╨▒╤А╨░╨▒╨╛╤В╨║╨╕ ╨▓╨╕╨┤╨╡╨╛.";
      if (errorMsg.includes("too big") || errorMsg.includes("file is too big")) {
        userMsg += `\n\nЁЯУж ╨д╨░╨╣╨╗ ╤Б╨╗╨╕╤И╨║╨╛╨╝ ╨▒╨╛╨╗╤М╤И╨╛╨╣ (${fileSizeMb.toFixed(1)} MB).`;
        userMsg += `\n╨Я╨╛╨┐╤А╨╛╨▒╤Г╨╣ ╤Б╨╢╨░╤В╤М ╨▓╨╕╨┤╨╡╨╛ ╨╕╨╗╨╕ ╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╣ ╤Д╨░╨╣╨╗ ╨┤╨╛ 20-30 MB.`;
      } else if (errorMsg.includes("ffprobe")) {
        userMsg += `\n\nтЪая╕П ╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨╛╨┐╤А╨╡╨┤╨╡╨╗╨╕╤В╤М ╨┐╨░╤А╨░╨╝╨╡╤В╤А╤Л ╨▓╨╕╨┤╨╡╨╛.`;
        userMsg += `\n╨Я╤А╨╛╨▓╨╡╤А╤М, ╤З╤В╨╛ ╨▓╨╕╨┤╨╡╨╛ ╨▓ ╤Д╨╛╤А╨╝╨░╤В╨╡ MP4 ╨╕ ╨╜╨╡ ╨┐╨╛╨▓╤А╨╡╨╢╨┤╨╡╨╜╨╛.`;
      } else {
        userMsg += `\n\n╨Ф╨╡╤В╨░╨╗╨╕: ${errorMsg.substring(0, 100)}`;
      }
      
      await ctx.reply(userMsg);
    }
  });

  // ╨Ю╨▒╤А╨░╨▒╨╛╤В╨║╨░ ╤В╨╡╨║╤Б╤В╨╛╨▓╤Л╤Е ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╨╣ (╨┤╨╗╤П ╨┤╨╕╨░╨╗╨╛╨│╨░ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╕╤П/╤А╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╜╨╕╤П ╤Б╤Ж╨╡╨╜╤Л ╨╕ ╨┐╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╡╨╜╨╕╤П)
  bot.on(message("text"), async (ctx) => {
    const userId = ctx.from?.id;
    const text = ctx.message.text;

    if (!userId) return;

    // ╨Ю╤В╨╝╨╡╨╜╨░
    if (text === "тЭМ ╨Ю╤В╨╝╨╡╨╜╨░" || text.toLowerCase() === "╨╛╤В╨╝╨╡╨╜╨░") {
      const [hasPendingScene, hasPendingEdit, hasPendingJoin] = await Promise.all([
        botState.getPendingScene(userId),
        botState.getPendingEdit(userId),
        botState.getPendingJoin(userId),
      ]);
      const hadPending = hasPendingScene !== null || hasPendingEdit !== null || hasPendingJoin;
      
      await botState.clearAll(userId);
      
      console.log(`[Bot] User ${userId} cancelled operation. Had pending:`, hadPending);
      
      // ╨Т╤Б╨╡╨│╨┤╨░ ╨▓╨╛╨╖╨▓╤А╨░╤Й╨░╨╡╨╝ ╨│╨╗╨░╨▓╨╜╨╛╨╡ ╨╝╨╡╨╜╤О ╨┐╨╛╤Б╨╗╨╡ ╨╛╤В╨╝╨╡╨╜╤Л
      await ctx.reply(
        hadPending ? "тЭМ ╨Ю╨┐╨╡╤А╨░╤Ж╨╕╤П ╨╛╤В╨╝╨╡╨╜╨╡╨╜╨░" : "╨У╨╗╨░╨▓╨╜╨╛╨╡ ╨╝╨╡╨╜╤О",
        {
          reply_markup: getMainMenuKeyboard(ctx.from?.id), // ╨Т╤Б╨╡╨│╨┤╨░ ╨▓╨╛╨╖╨▓╤А╨░╤Й╨░╨╡╨╝ ╨│╨╗╨░╨▓╨╜╨╛╨╡ ╨╝╨╡╨╜╤О
        }
      );
      return;
    }

    // ╨Х╤Б╨╗╨╕ ╤Н╤В╨╛ ╨░╨┤╨╝╨╕╨╜ ╨╕ ╤В╨╡╨║╤Б╤В ╨┐╨╛╤Е╨╛╨╢ ╨╜╨░ URL, ╨╕ ╨╜╨╡╤В ╨░╨║╤В╨╕╨▓╨╜╨╛╨│╨╛ ╨┤╨╕╨░╨╗╨╛╨│╨░ - ╨┐╤А╨╡╨┤╨╗╨░╨│╨░╨╡╨╝ ╨╖╨░╨│╤А╤Г╨╖╨╕╤В╤М ╨▓╨╕╨┤╨╡╨╛ ╨┐╨╛ URL
    const [hasPendingScene, hasPendingEdit, hasPendingJoin] = await Promise.all([
      botState.getPendingScene(userId),
      botState.getPendingEdit(userId),
      botState.getPendingJoin(userId),
    ]);
    
    if (userId && isAdmin(userId) && isValidUrl(text) && !hasPendingScene && !hasPendingEdit && !hasPendingJoin) {
      await ctx.reply(
        `ЁЯФЧ ╨Э╨░╨╣╨┤╨╡╨╜╨░ ╤Б╤Б╤Л╨╗╨║╨░ ╨╜╨░ ╤Д╨░╨╣╨╗!\n\n` +
        `╨е╨╛╤З╨╡╤И╤М ╨╖╨░╨│╤А╤Г╨╖╨╕╤В╤М ╨▓╨╕╨┤╨╡╨╛ ╨┐╨╛ ╤Н╤В╨╛╨╣ ╤Б╤Б╤Л╨╗╨║╨╡?\n\n` +
        `╨Ш╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╣ ╨║╨╛╨╝╨░╨╜╨┤╤Г: /upload_url ${text}\n\n` +
        `╨Ш╨╗╨╕ ╨╜╨░╨╢╨╝╨╕ ╨║╨╜╨╛╨┐╨║╤Г ╨╜╨╕╨╢╨╡:`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "тЬЕ ╨Ч╨░╨│╤А╤Г╨╖╨╕╤В╤М ╨┐╨╛ ╤Б╤Б╤Л╨╗╨║╨╡", callback_data: `upload_url:${encodeURIComponent(text)}` }],
            ],
          },
        }
      );
      return;
    }

    // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝, ╨╡╤Б╤В╤М ╨╗╨╕ ╨░╨║╤В╨╕╨▓╨╜╤Л╨╣ ╨┤╨╕╨░╨╗╨╛╨│ ╤А╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╜╨╕╤П
    const pendingEdit = hasPendingEdit || await botState.getPendingEdit(userId);
    if (pendingEdit) {
      await handleEditDialog(ctx, userId, text, pendingEdit);
      return;
    }

    // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝, ╨╡╤Б╤В╤М ╨╗╨╕ ╨░╨║╤В╨╕╨▓╨╜╤Л╨╣ ╨┤╨╕╨░╨╗╨╛╨│ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╕╤П ╤Б╤Ж╨╡╨╜╤Л ╨Я╨Х╨а╨Х╨Ф ╨┐╤А╨╛╨▓╨╡╤А╨║╨╛╨╣ ╨┐╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╡╨╜╨╕╤П
    // ╨н╤В╨╛ ╨▓╨░╨╢╨╜╨╛, ╤З╤В╨╛╨▒╤Л ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕ ╨╛╨▒╤А╨░╨▒╨░╤В╤Л╨▓╨░╨╗╨╕╤Б╤М ╨┐╤А╨░╨▓╨╕╨╗╤М╨╜╨╛
    let pending = hasPendingScene || await botState.getPendingScene(userId);
    if (pending) {
      // ╨Х╤Б╤В╤М ╨░╨║╤В╨╕╨▓╨╜╤Л╨╣ ╨┤╨╕╨░╨╗╨╛╨│ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╕╤П ╤Б╤Ж╨╡╨╜╤Л, ╨╛╨▒╤А╨░╨▒╨░╤В╤Л╨▓╨░╨╡╨╝ ╨╡╨│╨╛ (╨┐╤А╨╛╨┤╨╛╨╗╨╢╨╕╨╝ ╨╜╨╕╨╢╨╡)
      console.log(`[Bot] User ${userId} has pending scene, step: ${pending.step}`);
    } else if (hasPendingJoin || await botState.getPendingJoin(userId)) {
      // ╨в╨╛╨╗╤М╨║╨╛ ╨╡╤Б╨╗╨╕ ╨╜╨╡╤В ╨░╨║╤В╨╕╨▓╨╜╨╛╨│╨╛ ╨┤╨╕╨░╨╗╨╛╨│╨░ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╕╤П ╤Б╤Ж╨╡╨╜╤Л, ╨╛╨▒╤А╨░╨▒╨░╤В╤Л╨▓╨░╨╡╨╝ ╨┐╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╡╨╜╨╕╨╡
      const sessionCode = text.trim().toLowerCase();
      
      console.log("[Bot] Searching for session with code:", sessionCode);
      
      // ╨Ш╤Й╨╡╨╝ ╤Б╨╡╤Б╤Б╨╕╤О ╨┐╨╛ ID (╨┐╨╛╨╗╨╜╨╛╨╝╤Г ╤Б╨╛╨▓╨┐╨░╨┤╨╡╨╜╨╕╤О) - ╤В╨╛╨╗╤М╨║╨╛ ╨░╨║╤В╨╕╨▓╨╜╤Л╨╡ ╤Б╨╡╤Б╤Б╨╕╨╕
      let session = await prisma.session.findFirst({
        where: { 
          id: sessionCode,
          status: { in: ["lobby", "recording"] }, // ╨в╨╛╨╗╤М╨║╨╛ ╨░╨║╤В╨╕╨▓╨╜╤Л╨╡ ╤Б╨╡╤Б╤Б╨╕╨╕
        },
        include: {
          participants: true,
          scene: true,
        },
      });

      // ╨Х╤Б╨╗╨╕ ╨╜╨╡ ╨╜╨░╤И╨╗╨╕ ╨┐╨╛ ╨┐╨╛╨╗╨╜╨╛╨╝╤Г ID, ╨╕╤Й╨╡╨╝ ╨┐╨╛ ╨┐╨╛╤Б╨╗╨╡╨┤╨╜╨╕╨╝ ╤Б╨╕╨╝╨▓╨╛╨╗╨░╨╝ (case-insensitive)
      if (!session && sessionCode.length >= 6) {
        console.log("[Bot] Full ID not found, searching by suffix...");
        // Get all active sessions and filter in memory (Prisma doesn't support case-insensitive endsWith)
        const allSessions = await prisma.session.findMany({
          where: {
            status: { in: ["lobby", "recording"] }, // ╨в╨╛╨╗╤М╨║╨╛ ╨░╨║╤В╨╕╨▓╨╜╤Л╨╡ ╤Б╨╡╤Б╤Б╨╕╨╕
          },
          include: {
            participants: true,
            scene: true,
          },
          orderBy: { createdAt: "desc" },
          take: 50, // Limit to recent sessions
        });
        
        // Find session where ID ends with the code (case-insensitive)
        session = allSessions.find(s => 
          s.id.toLowerCase().endsWith(sessionCode)
        ) || null;
        
        console.log("[Bot] Found by suffix:", session ? session.id : "none");
      }

      await botState.deletePendingJoin(userId);
      
      console.log("[Bot] Session search result:", session ? { id: session.id, status: session.status, participants: session.participants.length } : "not found");

      if (!session) {
        // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝, ╨╝╨╛╨╢╨╡╤В ╤Б╨╡╤Б╤Б╨╕╤П ╤Б╤Г╤Й╨╡╤Б╤В╨▓╤Г╨╡╤В, ╨╜╨╛ ╤Г╨╢╨╡ ╨╖╨░╨▓╨╡╤А╤И╨╡╨╜╨░
        const completedSession = await prisma.session.findFirst({
          where: { 
            id: sessionCode,
          },
          select: { id: true, status: true },
        });

        if (completedSession) {
          await ctx.reply(
            `тЭМ ╨н╤В╨░ ╨╕╨│╤А╨░ ╤Г╨╢╨╡ ╨╖╨░╨▓╨╡╤А╤И╨╡╨╜╨░.\n\n` +
            `╨б╤В╨░╤В╤Г╤Б: ${completedSession.status}\n\n` +
            `╨б╨╛╨╖╨┤╨░╨╣ ╨╜╨╛╨▓╤Г╤О ╨╕╨│╤А╤Г ╨╕╨╗╨╕ ╨┐╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╕╤Б╤М ╨║ ╨░╨║╤В╨╕╨▓╨╜╨╛╨╣.`,
            { reply_markup: getMainMenuKeyboard(ctx.from?.id) }
          );
        } else {
          await ctx.reply(
            `тЭМ ╨б╨╡╤Б╤Б╨╕╤П ╤Б ╨║╨╛╨┤╨╛╨╝ "${sessionCode}" ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╨░.\n\n` +
            `╨Я╤А╨╛╨▓╨╡╤А╤М╤В╨╡ ╨║╨╛╨┤ ╨╕ ╨┐╨╛╨┐╤А╨╛╨▒╤Г╨╣╤В╨╡ ╨╡╤Й╤С ╤А╨░╨╖.`,
            { reply_markup: getMainMenuKeyboard(ctx.from?.id) }
          );
        }
        return;
      }

      // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝, ╨╜╨╡ ╨┐╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╕╨╗╤Б╤П ╨╗╨╕ ╤Г╨╢╨╡
      const alreadyJoined = session.participants.some(p => p.tgUserId === String(userId));
      if (alreadyJoined) {
        await ctx.reply(
          `тЬЕ ╨Т╤Л ╤Г╨╢╨╡ ╨▓ ╤Н╤В╨╛╨╣ ╨╕╨│╤А╨╡!\n\n` +
          `╨Э╨░╨╢╨╝╨╕╤В╨╡ ╨║╨╜╨╛╨┐╨║╤Г ╨╜╨╕╨╢╨╡, ╤З╤В╨╛╨▒╤Л ╨╛╤В╨║╤А╤Л╤В╤М ╨╕╨│╤А╤Г:`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "ЁЯОо ╨Ю╤В╨║╤А╤Л╤В╤М ╨╕╨│╤А╤Г",
                    web_app: { url: `${config.webappUrl}/s/${session.id}` },
                  },
                ],
              ],
            },
          }
        );
        return;
      }

      // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝, ╨╡╤Б╤В╤М ╨╗╨╕ ╨╝╨╡╤Б╤В╨╛
      if (session.participants.length >= session.maxPlayers) {
        await ctx.reply(
          `тЭМ ╨Ш╨│╤А╨░ ╤Г╨╢╨╡ ╨┐╨╛╨╗╨╜╨░╤П (${session.maxPlayers}/${session.maxPlayers} ╨╕╨│╤А╨╛╨║╨╛╨▓).`,
          { reply_markup: { remove_keyboard: true } }
        );
        return;
      }

      // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝ ╤Б╤В╨░╤В╤Г╤Б - ╨┤╨╗╤П "recording" ╨╝╨╛╨╢╨╜╨╛ ╨┐╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╕╤В╤М╤Б╤П, ╨╡╤Б╨╗╨╕ ╨╡╤Й╨╡ ╨╡╤Б╤В╤М ╨╝╨╡╤Б╤В╨╛
      // ╨Э╨╛ ╨╗╤Г╤З╤И╨╡ ╤А╨░╨╖╤А╨╡╤И╨╕╤В╤М ╤В╨╛╨╗╤М╨║╨╛ ╨┤╨╗╤П "lobby"
      if (session.status !== "lobby" && session.status !== "recording") {
        await ctx.reply(
          `тЭМ ╨Ш╨│╤А╨░ ╤Г╨╢╨╡ ╨╖╨░╨▓╨╡╤А╤И╨╡╨╜╨░ (╤Б╤В╨░╤В╤Г╤Б: ${session.status}).\n\n` +
          `╨б╨╛╨╖╨┤╨░╨╣ ╨╜╨╛╨▓╤Г╤О ╨╕╨│╤А╤Г ╨╕╨╗╨╕ ╨┐╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╕╤Б╤М ╨║ ╨░╨║╤В╨╕╨▓╨╜╨╛╨╣.`,
            { reply_markup: getMainMenuKeyboard(ctx.from?.id) }
        );
        return;
      }
      
      // ╨Х╤Б╨╗╨╕ ╤Б╤В╨░╤В╤Г╤Б "recording", ╨╜╨╛ ╨╡╤Й╨╡ ╨╡╤Б╤В╤М ╨╝╨╡╤Б╤В╨╛ - ╨╝╨╛╨╢╨╜╨╛ ╨┐╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╕╤В╤М╤Б╤П
      // ╨Э╨╛ ╨┤╨╗╤П "recording" ╨╗╤Г╤З╤И╨╡ ╨╜╨╡ ╤А╨░╨╖╤А╨╡╤И╨░╤В╤М ╨┐╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╡╨╜╨╕╨╡ (╨╕╨│╤А╨░ ╤Г╨╢╨╡ ╨╕╨┤╨╡╤В)
      if (session.status === "recording") {
        await ctx.reply(
          `тЭМ ╨Ш╨│╤А╨░ ╤Г╨╢╨╡ ╨╜╨░╤З╨░╨╗╨░╤Б╤М. ╨Ь╨╛╨╢╨╜╨╛ ╨┐╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╕╤В╤М╤Б╤П ╤В╨╛╨╗╤М╨║╨╛ ╨║ ╨╕╨│╤А╨░╨╝ ╨▓ ╨╗╨╛╨▒╨▒╨╕.`,
            { reply_markup: getMainMenuKeyboard(ctx.from?.id) }
        );
        return;
      }

      // ╨Т╤Б╤С ╨╛╨║, ╨╛╤В╨║╤А╤Л╨▓╨░╨╡╨╝ Mini App ╤З╨╡╤А╨╡╨╖ ╤Б╤Б╤Л╨╗╨║╤Г (╨╜╨╡ inline web_app button)
      // Inline web_app buttons ╨╕╨╝╨╡╤О╤В ╨▒╨░╨│ ╨╜╨░ iOS - ╨╛╤В╨║╤А╤Л╨▓╨░╤О╤В WebView ╨▓╨╝╨╡╤Б╤В╨╛ Mini App
      const joinLink = `https://t.me/${config.botUsername}?startapp=s_${session.id}`;
      await ctx.reply(
        `тЬЕ ╨Э╨░╨╣╨┤╨╡╨╜╨░ ╨╕╨│╤А╨░!\n\n` +
        `╨Ш╨│╤А╨╛╨║╨╛╨▓: ${session.participants.length}/${session.maxPlayers}\n` +
        `╨Ъ╨░╤В╨╡╨│╨╛╤А╨╕╤П: ${CATEGORY_LABELS[session.category as SceneCategory] || session.category}\n\n` +
        `ЁЯСЙ ╨Э╨░╨╢╨╝╨╕╤В╨╡ ╨╜╨░ ╤Б╤Б╤Л╨╗╨║╤Г ╤З╤В╨╛╨▒╤Л ╨┐╤А╨╕╤Б╨╛╨╡╨┤╨╕╨╜╨╕╤В╤М╤Б╤П:\n${joinLink}`,
        { 
          reply_markup: getMainMenuKeyboard(ctx.from?.id),
          // Telegram auto-converts the link to a clickable button
        }
      );
      return;
    }

    // ╨Ю╨▒╤А╨░╨▒╨╛╤В╨║╨░ ╨┤╨╕╨░╨╗╨╛╨│╨░ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨╕╤П ╤Б╤Ж╨╡╨╜╤Л (╨╡╤Б╨╗╨╕ pending ╤Г╨╢╨╡ ╨╛╨┐╤А╨╡╨┤╨╡╨╗╨╡╨╜ ╨▓╤Л╤И╨╡)
    // ╨Я╨╡╤А╨╡╨╛╨┐╤А╨╡╨┤╨╡╨╗╤П╨╡╨╝ pending ╨╜╨░ ╤Б╨╗╤Г╤З╨░╨╣, ╨╡╤Б╨╗╨╕ ╨╛╨╜ ╨▒╤Л╨╗ ╨╛╨┐╤А╨╡╨┤╨╡╨╗╨╡╨╜ ╨▓╤Л╤И╨╡, ╨╜╨╛ ╨╝╨╛╨│ ╨▒╤Л╤В╤М ╨╕╨╖╨╝╨╡╨╜╨╡╨╜
    if (!pending) {
      pending = await botState.getPendingScene(userId);
    }
    
    if (!pending) {
      console.log(`[Bot] No pending scene for user ${userId}, text:`, text);
      return; // ╨Э╨╡╤В ╨░╨║╤В╨╕╨▓╨╜╨╛╨│╨╛ ╨┤╨╕╨░╨╗╨╛╨│╨░
    }
    
    console.log(`[Bot] Processing pending scene for user ${userId}, step: ${pending.step}, text:`, text);

    // ╨и╨░╨│ 1: ╨Я╨╛╨╗╤Г╤З╨░╨╡╨╝ ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡
    if (pending.step === "awaiting_title") {
      pending.title = text.trim();
      pending.step = "awaiting_category";
      await botState.setPendingScene(userId, pending);

      await ctx.reply(
        `ЁЯСН ╨Э╨░╨╖╨▓╨░╨╜╨╕╨╡: "${pending.title}"\n\n` +
        `╨Т╤Л╨▒╨╡╤А╨╕ ╨║╨░╤В╨╡╨│╨╛╤А╨╕╤О:`,
        {
          reply_markup: {
            keyboard: [
              [{ text: "ЁЯОм ╨Ъ╨╕╨╜╨╛/╤Б╨╡╤А╨╕╨░╨╗╤Л" }],
              [{ text: "ЁЯШВ ╨Ь╨╡╨╝╤Л" }],
              [{ text: "ЁЯПЫя╕П ╨Я╨╛╨╗╨╕╤В╨╕╨║╨░" }],
              [{ text: "тЭМ ╨Ю╤В╨╝╨╡╨╜╨░" }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
      return;
    }

    // ╨и╨░╨│ 2: ╨Я╨╛╨╗╤Г╤З╨░╨╡╨╝ ╨║╨░╤В╨╡╨│╨╛╤А╨╕╤О
    if (pending.step === "awaiting_category") {
      console.log(`[Bot] User ${userId} selecting category, text:`, text);
      console.log(`[Bot] Pending before category selection:`, { step: pending.step, title: pending.title });
      
      let category: SceneCategory;
      if (text.includes("╨Ъ╨╕╨╜╨╛") || text.includes("╤Б╨╡╤А╨╕╨░╨╗") || text.includes("ЁЯОм")) {
        category = "movies";
      } else if (text.includes("╨Ь╨╡╨╝") || text.includes("ЁЯШВ")) {
        category = "memes";
      } else if (text.includes("╨Я╨╛╨╗╨╕╤В") || text.includes("ЁЯПЫя╕П")) {
        category = "politics";
      } else {
        console.log(`[Bot] Invalid category text:`, text);
        await ctx.reply("тЭМ ╨Т╤Л╨▒╨╡╤А╨╕ ╨║╨░╤В╨╡╨│╨╛╤А╨╕╤О ╨╕╨╖ ╨║╨╜╨╛╨┐╨╛╨║");
        return;
      }

      pending.category = category;
      pending.step = "awaiting_cues";
      await botState.setPendingScene(userId, pending);
      
      console.log(`[Bot] Category selected, pending saved:`, { step: pending.step, category: pending.category, userId });

      await ctx.reply(
        `ЁЯСН ╨Ъ╨░╤В╨╡╨│╨╛╤А╨╕╤П: ${CATEGORY_LABELS[category]}\n\n` +
        `╨в╨╡╨┐╨╡╤А╤М ╨▓╨▓╨╡╨┤╨╕ ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕ ╤А╨╡╨┐╨╗╨╕╨║ ╨Т ╨Ъ╨Р╨Ф╨а╨Р╨е.\n\n` +
        `ЁЯУЭ ╨Я╨╛╨┤╨┤╨╡╤А╨╢╨╕╨▓╨░╨╡╨╝╤Л╨╡ ╤Д╨╛╤А╨╝╨░╤В╤Л:\n` +
        `тАв \`0-125, 150-275\` (╨╛╨▒╤Л╤З╨╜╤Л╨╣)\n` +
        `тАв \`╨Ш╨│╤А╨╛╨║ 1 тАФ 280 - 367\`\n` +
        `тАв \`╨Ш╨│╤А╨╛╨║ 2 тАФ 787 - 922\`\n\n` +
        `ЁЯУК ╨Т╤Б╨╡╨│╨╛ ╨║╨░╨┤╤А╨╛╨▓: ${pending.totalFrames}\n` +
        `ЁЯОЮ FPS: ${pending.fps}\n\n` +
        `╨Ь╨╛╨╢╨╜╨╛ ╤Г╨║╨░╨╖╨░╤В╤М ╨▓╤Б╨╡ ╤А╨╡╨┐╨╗╨╕╨║╨╕ ╨╛╨┤╨╜╨╛╨╣ ╤Б╤В╤А╨╛╨║╨╛╨╣ ╨╕╨╗╨╕ ╨┐╨╛ ╨╛╨┤╨╜╨╛╨╣ ╨╜╨░ ╤Б╤В╤А╨╛╨║╤Г.`,
        { 
          parse_mode: "Markdown",
          reply_markup: {
            keyboard: [[{ text: "тЭМ ╨Ю╤В╨╝╨╡╨╜╨░" }]],
            resize_keyboard: true,
            one_time_keyboard: false, // ╨Я╨╛╤Б╤В╨╛╤П╨╜╨╜╨░╤П ╨║╨╗╨░╨▓╨╕╨░╤В╤Г╤А╨░
          },
        }
      );
      
      // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝, ╤З╤В╨╛ ╤Б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╡ ╤Б╨╛╤Е╤А╨░╨╜╨╕╨╗╨╛╤Б╤М
      const savedPending = await botState.getPendingScene(userId);
      console.log(`[Bot] Pending after save:`, savedPending ? { step: savedPending.step, category: savedPending.category } : "null");
      
      return;
    }

    // ╨и╨░╨│ 3: ╨Я╨╛╨╗╤Г╤З╨░╨╡╨╝ ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕ ╨Т ╨Ъ╨Р╨Ф╨а╨Р╨е
    if (pending.step === "awaiting_cues") {
      console.log(`[Bot] User ${userId} entered cues text:`, text);
      console.log(`[Bot] Pending state:`, { step: pending.step, title: pending.title, category: pending.category });
      
      const cues = parseCuesFrames(text);

      if (!cues || cues.length === 0) {
        console.log(`[Bot] Failed to parse cues for user ${userId}, text:`, text);
        await ctx.reply(
          "тЭМ ╨Э╨╡╨▓╨╡╤А╨╜╤Л╨╣ ╤Д╨╛╤А╨╝╨░╤В ╤В╨░╨╣╨╝╨╕╨╜╨│╨╛╨▓.\n\n" +
          "ЁЯУЭ ╨Ш╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╣ ╨╛╨┤╨╕╨╜ ╨╕╨╖ ╤Д╨╛╤А╨╝╨░╤В╨╛╨▓:\n" +
          "тАв `0-125, 150-275` (╨╛╨▒╤Л╤З╨╜╤Л╨╣)\n" +
          "тАв `╨Ш╨│╤А╨╛╨║ 1 тАФ 280 - 367` (╤Б ╨┐╤А╨╡╤Д╨╕╨║╤Б╨╛╨╝)\n" +
          "тАв `╨Ш╨│╤А╨╛╨║ 2 тАФ 787 - 922`\n\n" +
          "╨Ь╨╛╨╢╨╜╨╛ ╤Г╨║╨░╨╖╨░╤В╤М ╨▓╤Б╨╡ ╤А╨╡╨┐╨╗╨╕╨║╨╕ ╨╛╨┤╨╜╨╛╨╣ ╤Б╤В╤А╨╛╨║╨╛╨╣ ╨╕╨╗╨╕ ╨┐╨╛ ╨╛╨┤╨╜╨╛╨╣ ╨╜╨░ ╤Б╤В╤А╨╛╨║╤Г.\n\n" +
          "╨Я╨╛╨┐╤А╨╛╨▒╤Г╨╣ ╨╡╤Й╤С ╤А╨░╨╖:",
          { 
            parse_mode: "Markdown",
            reply_markup: {
              keyboard: [[{ text: "тЭМ ╨Ю╤В╨╝╨╡╨╜╨░" }]],
              resize_keyboard: true,
              one_time_keyboard: false,
            },
          }
        );
        return;
      }

      console.log(`[Bot] Successfully parsed ${cues.length} cues:`, cues);

      // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝, ╤З╤В╨╛ ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕ ╨▓ ╨┐╤А╨╡╨┤╨╡╨╗╨░╤Е ╨▓╨╕╨┤╨╡╨╛
      const maxEndFrame = Math.max(...cues.map(c => c.endFrame));
      if (maxEndFrame > pending.totalFrames + pending.fps) {
        await ctx.reply(
          `тЭМ ╨Ъ╨░╨┤╤А ${maxEndFrame} ╨▓╤Л╤Е╨╛╨┤╨╕╤В ╨╖╨░ ╨┐╤А╨╡╨┤╨╡╨╗╤Л ╨▓╨╕╨┤╨╡╨╛ (${pending.totalFrames} ╨║╨░╨┤╤А╨╛╨▓).\n` +
          `╨Я╨╛╨┐╤А╨╛╨▒╤Г╨╣ ╨╡╤Й╤С ╤А╨░╨╖:`
        );
        return;
      }

      await ctx.reply("тП│ ╨Ч╨░╨│╤А╤Г╨╢╨░╤О ╨▓╨╕╨┤╨╡╨╛ ╨▓ ╤Е╤А╨░╨╜╨╕╨╗╨╕╤Й╨╡...");

      try {
        // ╨б╨║╨░╤З╨╕╨▓╨░╨╡╨╝ ╨▓╨╕╨┤╨╡╨╛ (╨╗╨╕╨▒╨╛ ╨╕╨╖ Telegram, ╨╗╨╕╨▒╨╛ ╨┐╨╛ URL)
        let buffer: Buffer;
        if (pending.fileUrl) {
          // ╨Ч╨░╨│╤А╤Г╨╢╨░╨╡╨╝ ╨┐╨╛ URL
          console.log(`[Bot] Downloading video from URL: ${pending.fileUrl}`);
          const result = await downloadFileFromUrl(pending.fileUrl);
          buffer = result.buffer;
        } else if (pending.fileId) {
          // ╨Ч╨░╨│╤А╤Г╨╢╨░╨╡╨╝ ╨╕╨╖ Telegram
          console.log(`[Bot] Downloading video from Telegram: ${pending.fileId}`);
          const result = await downloadTelegramFile(bot, pending.fileId);
          buffer = result.buffer;
        } else {
          throw new Error("No file source specified (fileId or fileUrl)");
        }

        // ╨У╨╡╨╜╨╡╤А╨╕╤А╤Г╨╡╨╝ ID ╤Б╤Ж╨╡╨╜╤Л
        const sceneId = `scene_${Date.now()}`;
        const s3Key = `scenes/${sceneId}.mp4`;

        // ╨Ч╨░╨│╤А╤Г╨╢╨░╨╡╨╝ ╨▓ S3
        await storage.upload(s3Key, buffer, "video/mp4");

        // ╨д╨╛╤А╨╝╨╕╤А╤Г╨╡╨╝ cueJson ╨Т ╨Ъ╨Р╨Ф╨а╨Р╨е (╨╜╨╛╨▓╤Л╨╣ ╤Д╨╛╤А╨╝╨░╤В!)
        const cueJson = JSON.stringify(
          cues.map((c, i) => ({
            roleIndex: i,
            startFrame: c.startFrame,
            durationFrames: c.endFrame - c.startFrame,
          }))
        );

        // ╨б╨╛╨╖╨┤╨░╤С╨╝ ╨╖╨░╨┐╨╕╤Б╤М ╨▓ ╨▒╨░╨╖╨╡
        await prisma.scene.create({
          data: {
            id: sceneId,
            title: pending.title!,
            category: pending.category || "memes",
            s3Key,
            durationSec: pending.duration,
            fps: pending.fps,
            rolesCount: cues.length,
            cueJson,
          },
        });

        // ╨Ю╤З╨╕╤Й╨░╨╡╨╝ ╤Б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╡
        await botState.deletePendingScene(userId);

        // ╨Я╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╨╝ ╨╕ ╨║╨░╨┤╤А╤Л ╨╕ ╤Б╨╡╨║╤Г╨╜╨┤╤Л
        const fps = pending.fps;
        const cueInfo = cues.map((c, i) => {
          const startSec = (c.startFrame / fps).toFixed(2);
          const endSec = (c.endFrame / fps).toFixed(2);
          return `  ╨Ш╨│╤А╨╛╨║ ${i + 1}: ╨║╨░╨┤╤А╤Л ${c.startFrame}-${c.endFrame} (${startSec}s тАФ ${endSec}s)`;
        }).join("\n");

        await ctx.reply(
          `тЬЕ ╨б╤Ж╨╡╨╜╨░ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╨░!\n\n` +
          `ЁЯУЭ ╨Э╨░╨╖╨▓╨░╨╜╨╕╨╡: ${pending.title}\n` +
          `ЁЯЖФ ID: ${sceneId}\n` +
          `тП▒ ╨Ф╨╗╨╕╤В╨╡╨╗╤М╨╜╨╛╤Б╤В╤М: ${pending.duration}s\n` +
          `ЁЯОЮ FPS: ${fps}\n` +
          `ЁЯОн ╨а╨╡╨┐╨╗╨╕╨║: ${cues.length}\n\n` +
          `╨в╨░╨╣╨╝╨╕╨╜╨│╨╕:\n${cueInfo}`,
          { reply_markup: { remove_keyboard: true } }
        );

      } catch (err) {
        console.error("Scene upload error:", err);
        await botState.deletePendingScene(userId);
        await ctx.reply(
          "тЭМ ╨Ю╤И╨╕╨▒╨║╨░ ╨╖╨░╨│╤А╤Г╨╖╨║╨╕. ╨Я╨╛╨┐╤А╨╛╨▒╤Г╨╣ ╨╡╤Й╤С ╤А╨░╨╖.",
          { reply_markup: { remove_keyboard: true } }
        );
      }
    }
  });

  // Helper: ╨╛╨▒╤А╨░╨▒╨╛╤В╨║╨░ ╨┤╨╕╨░╨╗╨╛╨│╨░ ╤А╨╡╨┤╨░╨║╤В╨╕╤А╨╛╨▓╨░╨╜╨╕╤П
  async function handleEditDialog(ctx: Context, userId: number, text: string, pendingEdit: PendingEdit) {
    // ╨и╨░╨│ 1: ╨Т╤Л╨▒╨╛╤А ╤Б╤Ж╨╡╨╜╤Л ╨┐╨╛ ID
    if (pendingEdit.step === "awaiting_sceneId") {
      const sceneId = text.trim();
      await startCueEditing(ctx, userId, sceneId);
      return;
    }

    // ╨и╨░╨│ 2: ╨Э╨╛╨▓╤Л╨╡ ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕ ╨Т ╨Ъ╨Р╨Ф╨а╨Р╨е
    if (pendingEdit.step === "awaiting_new_cues" && pendingEdit.scene) {
      const cues = parseCuesFrames(text);

      if (!cues) {
        await ctx.reply(
          "тЭМ ╨Э╨╡╨▓╨╡╤А╨╜╤Л╨╣ ╤Д╨╛╤А╨╝╨░╤В. ╨Ш╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╣ ╨ж╨Х╨Ы╨л╨Х ╤З╨╕╤Б╨╗╨░ (╨║╨░╨┤╤А╤Л): `0-125, 150-275`\n" +
          "╨Я╨╛╨┐╤А╨╛╨▒╤Г╨╣ ╨╡╤Й╤С ╤А╨░╨╖:",
          { parse_mode: "Markdown" }
        );
        return;
      }

      // ╨Я╤А╨╛╨▓╨╡╤А╤П╨╡╨╝, ╤З╤В╨╛ ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕ ╨▓ ╨┐╤А╨╡╨┤╨╡╨╗╨░╤Е ╨▓╨╕╨┤╨╡╨╛
      const maxEndFrame = Math.max(...cues.map(c => c.endFrame));
      if (maxEndFrame > pendingEdit.scene.totalFrames + pendingEdit.scene.fps) {
        await ctx.reply(
          `тЭМ ╨Ъ╨░╨┤╤А ${maxEndFrame} ╨▓╤Л╤Е╨╛╨┤╨╕╤В ╨╖╨░ ╨┐╤А╨╡╨┤╨╡╨╗╤Л ╨▓╨╕╨┤╨╡╨╛ (${pendingEdit.scene.totalFrames} ╨║╨░╨┤╤А╨╛╨▓).\n` +
          `╨Я╨╛╨┐╤А╨╛╨▒╤Г╨╣ ╨╡╤Й╤С ╤А╨░╨╖:`
        );
        return;
      }

      try {
        // ╨д╨╛╤А╨╝╨╕╤А╤Г╨╡╨╝ ╨╜╨╛╨▓╤Л╨╣ cueJson ╨Т ╨Ъ╨Р╨Ф╨а╨Р╨е
        const cueJson = JSON.stringify(
          cues.map((c, i) => ({
            roleIndex: i,
            startFrame: c.startFrame,
            durationFrames: c.endFrame - c.startFrame,
          }))
        );

        // ╨Ю╨▒╨╜╨╛╨▓╨╗╤П╨╡╨╝ ╤Б╤Ж╨╡╨╜╤Г
        await prisma.scene.update({
          where: { id: pendingEdit.sceneId },
          data: {
            cueJson,
            rolesCount: cues.length,
          },
        });

        await botState.deletePendingEdit(userId);

        // ╨Я╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╨╝ ╨╕ ╨║╨░╨┤╤А╤Л ╨╕ ╤Б╨╡╨║╤Г╨╜╨┤╤Л
        const fps = pendingEdit.scene.fps;
        const cueInfo = cues.map((c, i) => {
          const startSec = (c.startFrame / fps).toFixed(2);
          const endSec = (c.endFrame / fps).toFixed(2);
          return `  ╨Ш╨│╤А╨╛╨║ ${i + 1}: ╨║╨░╨┤╤А╤Л ${c.startFrame}-${c.endFrame} (${startSec}s тАФ ${endSec}s)`;
        }).join("\n");

        await ctx.reply(
          `тЬЕ ╨в╨░╨╣╨╝╨╕╨╜╨│╨╕ ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╤Л!\n\n` +
          `ЁЯУЭ ╨б╤Ж╨╡╨╜╨░: ${pendingEdit.scene.title}\n` +
          `ЁЯОн ╨а╨╡╨┐╨╗╨╕╨║: ${cues.length}\n\n` +
          `╨Э╨╛╨▓╤Л╨╡ ╤В╨░╨╣╨╝╨╕╨╜╨│╨╕:\n${cueInfo}`,
          { reply_markup: { remove_keyboard: true } }
        );

      } catch (err) {
        console.error("Cue update error:", err);
        await botState.deletePendingEdit(userId);
        await ctx.reply(
          "тЭМ ╨Ю╤И╨╕╨▒╨║╨░ ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨╕╤П. ╨Я╨╛╨┐╤А╨╛╨▒╤Г╨╣ ╨╡╤Й╤С ╤А╨░╨╖.",
          { reply_markup: { remove_keyboard: true } }
        );
      }
    }
  }

  // Error handling
  bot.catch((err, ctx) => {
    console.error("Bot error:", err);
    ctx.reply("╨Я╤А╨╛╨╕╨╖╨╛╤И╨╗╨░ ╨╛╤И╨╕╨▒╨║╨░. ╨Я╨╛╨┐╤А╨╛╨▒╤Г╨╣╤В╨╡ ╨┐╨╛╨╖╨╢╨╡.").catch(() => {});
  });

  return bot;
}

export async function sendVideoToCreator(
  bot: Telegraf,
  tgUserId: string,
  videoUrl: string,
  sessionId: string
): Promise<void> {
  try {
    await bot.telegram.sendVideo(
      tgUserId,
      { url: videoUrl },
      {
        caption: "ЁЯОм ╨Т╨░╤И ╨┤╤Г╨▒╨╗╤П╨╢ ╨│╨╛╤В╨╛╨▓!\n\n" +
          `╨Я╨╛╨┤╨╡╨╗╨╕╤В╨╡╤Б╤М ╤Б ╨┤╤А╤Г╨╖╤М╤П╨╝╨╕: t.me/${config.botUsername}?startapp=${sessionId}`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "ЁЯУд ╨Я╨╛╨┤╨╡╨╗╨╕╤В╤М╤Б╤П",
                switch_inline_query: `╨б╨╝╨╛╤В╤А╨╕ ╨╜╨░╤И ╨┤╤Г╨▒╨╗╤П╨╢! t.me/${config.botUsername}?startapp=${sessionId}`,
              },
            ],
          ],
        },
      }
    );
  } catch (err) {
    console.error("Failed to send video to creator:", err);
  }
}

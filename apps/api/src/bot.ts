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
import { RU } from "@dubdub/shared";

// Состояние диалога для добавления сцен
interface PendingScene {
  userId: number;
  fileId?: string; // Telegram file_id (если загружено через Telegram)
  fileUrl?: string; // Прямая ссылка на файл (если загружено по URL)
  duration: number;
  fps: number;
  totalFrames: number;
  step: "awaiting_title" | "awaiting_category" | "awaiting_cues";
  title?: string;
  category?: SceneCategory;
}

// Состояние диалога для редактирования сцен
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

function getNormalizedBotUsername(): string {
  const raw = (config.botUsername || "").trim();
  const normalized = raw.startsWith("@") ? raw.slice(1) : raw;
  if (!normalized) {
    console.error("[Bot] BOT_USERNAME is missing or empty");
    throw new Error("BOT_USERNAME is missing");
  }
  return normalized;
}

// getVideoInfo imported from ./lib/video-utils.js

async function downloadTelegramFile(
  bot: Telegraf,
  fileId: string
): Promise<{ buffer: Buffer; path: string }> {
  // Получаем информацию о файле
  const file = await bot.telegram.getFile(fileId);
  
  // Строим URL для скачивания (для больших файлов нужно использовать токен бота)
  const botToken = config.botToken;
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
  
  // Скачиваем файл
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
 * Скачивает файл по прямой ссылке (URL)
 * Поддерживает файлы любого размера
 */
async function downloadFileFromUrl(fileUrl: string): Promise<{ buffer: Buffer; path: string }> {
  
  // Проверяем, что это валидный URL
  try {
    const url = new URL(fileUrl);
    
    // Проверяем, что это не ссылка на страницу (например, Яндекс.Диск)
    if (url.hostname.includes('yandex.ru') || url.hostname.includes('disk.yandex')) {
      throw new Error("Yandex.Disk link detected. Please provide direct download link. For Yandex.Disk: right-click on file > 'Get link' > copy direct link, or use /d/ link.");
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
  
  // Скачиваем файл
  const response = await fetch(fileUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'video/*, application/octet-stream, */*',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download file from URL: ${response.status} ${response.statusText}`);
  }
  
  // Проверяем Content-Type (должен быть video или octet-stream)
  const contentType = response.headers.get('content-type') || '';
  const contentLength = response.headers.get('content-length');
  
  
  // Если это HTML - значит скачалась страница, а не файл
  if (contentType.includes('text/html')) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const htmlPreview = buffer.toString('utf-8', 0, Math.min(500, buffer.length));
    console.error(`[Bot] Downloaded HTML instead of video. Preview:`, htmlPreview);
    throw new Error("The link points to a web page, not a video file. Please provide a direct download link to the video file (ending with .mp4, .avi, etc.).");
  }
  
  if (!contentType.startsWith('video/') && !contentType.includes('octet-stream') && !contentType.includes('application/')) {
    console.warn(`[Bot] Warning: Unexpected content-type: ${contentType}`);
  }
  
  // Скачиваем файл
  const buffer = Buffer.from(await response.arrayBuffer());
  
  // Проверяем минимальный размер (видео должно быть хотя бы несколько KB)
  if (buffer.length < 1024) {
    throw new Error(`Downloaded file is too small (${buffer.length} bytes). This might be an error page or redirect. Please check the link.`);
  }
  
  // Проверяем, что это действительно бинарный файл (не HTML)
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
 * Проверяет, является ли текст валидным URL
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
 * Поддерживает форматы:
 * - "0-125, 150-275" (кадры через запятую)
 * - "Игрок 1 — 280 - 367" (формат с префиксом)
 * - "0 125, 150 275" (кадры через пробел)
 */
function parseCuesFrames(text: string): Array<{ startFrame: number; endFrame: number }> | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const cues: Array<{ startFrame: number; endFrame: number }> = [];

  for (const line of lines) {
    
    // Формат 1: "Игрок N — startFrame - endFrame" или "Игрок N — startFrame - endFrame"
    // Поддерживаем разные типы дефисов: — (em-dash), – (en-dash), - (hyphen)
    let match = line.match(/(?:Игрок|Player|Роль|Реплика|Ролик)\s*\d+\s*[—–\-]\s*(\d+)\s*[—–\-]\s*(\d+)/i);
    if (match) {
      const startFrame = parseInt(match[1]!, 10);
      const endFrame = parseInt(match[2]!, 10);
      if (!isNaN(startFrame) && !isNaN(endFrame) && startFrame < endFrame) {
        cues.push({ startFrame, endFrame });
      }
      continue;
    }

    // Формат 2: Просто "startFrame - endFrame" или "startFrame-endFrame" (без префикса "Игрок")
    match = line.match(/^(\d+)\s*[—–\-]\s*(\d+)$/);
    if (match) {
      const startFrame = parseInt(match[1]!, 10);
      const endFrame = parseInt(match[2]!, 10);
      if (!isNaN(startFrame) && !isNaN(endFrame) && startFrame < endFrame) {
        cues.push({ startFrame, endFrame });
      }
      continue;
    }

    // Формат 3: "0-125" или "0-125, 150-275" (обычный формат через запятую)
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

    // Формат 4: "0 125" (кадры через пробел, без дефиса)
    const spaceMatch = line.match(/^(\d+)\s+(\d+)$/);
    if (spaceMatch) {
      const startFrame = parseInt(spaceMatch[1]!, 10);
      const endFrame = parseInt(spaceMatch[2]!, 10);
      if (!isNaN(startFrame) && !isNaN(endFrame) && startFrame < endFrame) {
        cues.push({ startFrame, endFrame });
      }
    }
  }

  // Сортировать по startFrame
  cues.sort((a, b) => a.startFrame - b.startFrame);

  return cues.length > 0 ? cues : null;
}

export function createBot(): Telegraf {
  const bot = new Telegraf(config.botToken);

  // Main menu keyboard - всегда отображается внизу
  // For admins, will include admin panel button
  const getMainMenuKeyboard = (userId?: number) => {
    const baseKeyboard = [
      [
        { text: RU.bot.mainMenu.startGame },
        { text: RU.bot.mainMenu.joinGame },
      ],
      [
        { text: RU.bot.mainMenu.suggestEpisode },
      ],
    ] as Array<Array<{ text: string }>>;

    // Add admin panel button for admins
    if (userId && isAdmin(userId)) {
      baseKeyboard.push([
        { text: RU.bot.mainMenu.adminPanel },
      ]);
    }

    return {
      keyboard: baseKeyboard,
      resize_keyboard: true,
      persistent: true, // Постоянная клавиатура
    };
  };

  const mainMenuKeyboard = getMainMenuKeyboard();

  // /start command - with optional deep link parameter
  bot.start(async (ctx) => {
    const startPayload = ctx.startPayload;
    const userId = ctx.from?.id;

    console.log("[Bot] /start command received", { userId, startPayload });

    const welcomeText = RU.bot.start.welcome;

    // Send response immediately with persistent keyboard
    try {
      // Check for startapp parameters - these are passed when Mini App opens via link
      // Format: s_sessionId (direct session link) or join_CODE (join by code)
      if (startPayload && startPayload.startsWith("s_")) {
        // Direct session link - just show welcome, Mini App will handle the routing
        const sessionId = startPayload.slice(2); // Remove "s_" prefix
        console.log("[Bot] Direct session link, sessionId:", sessionId);
        
        await ctx.reply(
          RU.bot.start.openGameLink,
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
          const botUsername = getNormalizedBotUsername();
          const joinLink = `https://t.me/${botUsername}?startapp=s_${session.id}`;
          console.log("[Bot] Found session, sending link:", session.id);
          
          await ctx.reply(
            RU.bot.start.joinInvite(
              session.participants.length,
              session.maxPlayers,
              joinLink
            ),
            { reply_markup: getMainMenuKeyboard(userId) }
          );
        } else {
          // Session not found - show error
          await ctx.reply(
            RU.bot.start.joinNotFound(sessionCode),
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
        const userName = ctx.from?.first_name || RU.bot.start.anonymousName;
        const userLink = ctx.from?.username ? `@${ctx.from.username}` : `ID: ${userId}`;
        bot.telegram.sendMessage(
          config.notifyChannelId,
          RU.bot.start.newUserNotify(userName, userLink)
        ).catch((err) => {
          // Silently ignore - channel notification is not critical
          console.error("Failed to notify channel:", err.message);
        });
      }, 100);
    }
  });

  // Handle "Join game" button (from text menu)
  bot.hears(RU.bot.mainMenu.joinGame, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    
    console.log("[Bot] Join game button clicked", { userId });

    await botState.setPendingJoin(userId);
    await ctx.reply(RU.bot.join.prompt, {
      reply_markup: {
        keyboard: [
          [{ text: RU.bot.mainMenu.cancel }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    });
  });

  // Handle "Join game" inline button (legacy support)
  bot.action("join_game", async (ctx) => {
    try {
      await ctx.answerCbQuery().catch(() => {});
      const userId = ctx.from?.id;
      if (!userId) return;
      const callbackData = (ctx.callbackQuery as { data?: string } | undefined)?.data;
      console.log("[Bot] callback join_game", {
        userId,
        chatId: ctx.chat?.id,
        callback: callbackData,
      });
      
      console.log("[Bot] join_game inline button clicked", { userId });

      await botState.setPendingJoin(userId);
      await ctx.reply(RU.bot.join.prompt, {
        reply_markup: {
          keyboard: [
            [{ text: RU.bot.mainMenu.cancel }],
          ],
          resize_keyboard: true,
          one_time_keyboard: false,
        },
      });
    } catch (err) {
      console.error("[Bot] Error in join_game handler:", err);
      await ctx.answerCbQuery(RU.bot.errors.generic).catch(() => {});
    }
  });

  // /join command - same as clicking "Join game" button
  bot.command("join", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await botState.setPendingJoin(userId);
    await ctx.reply(RU.bot.join.prompt, {
      reply_markup: {
        keyboard: [[{ text: RU.bot.mainMenu.cancel }]],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    });
  });

  // Handle "Start game" button (from text menu)
  // NOTE: Using text link instead of inline web_app button - iOS bug workaround [[memory:13197292]]
  bot.hears(RU.bot.mainMenu.startGame, async (ctx) => {
    const botUsername = getNormalizedBotUsername();
    // Use ?startapp= to open Mini App correctly on all platforms
    const appLink = `https://t.me/${botUsername}/app`;
    
    await ctx.reply(RU.bot.startGame.openLink(appLink), {
      reply_markup: getMainMenuKeyboard(ctx.from?.id),
    });
  });

  // Handle reply-keyboard buttons sent after video (worker)
  bot.hears(RU.worker.telegramKeyboard.play, async (ctx) => {
    const botUsername = getNormalizedBotUsername();
    const appLink = `https://t.me/${botUsername}/app`;
    console.log("[Bot] Play button clicked (worker keyboard)", { userId: ctx.from?.id });
    await ctx.reply(RU.bot.startGame.openLink(appLink), {
      reply_markup: getMainMenuKeyboard(ctx.from?.id),
    });
  });

  bot.hears(RU.worker.telegramKeyboard.playAgain, async (ctx) => {
    const botUsername = getNormalizedBotUsername();
    const appLink = `https://t.me/${botUsername}/app`;
    console.log("[Bot] Play again button clicked (worker keyboard)", { userId: ctx.from?.id });
    await ctx.reply(RU.bot.startGame.openLink(appLink), {
      reply_markup: getMainMenuKeyboard(ctx.from?.id),
    });
  });

  bot.hears(RU.worker.telegramKeyboard.mainMenu, async (ctx) => {
    console.log("[Bot] Main menu button clicked (worker keyboard)", { userId: ctx.from?.id });
    await ctx.reply(RU.bot.start.welcome, {
      reply_markup: getMainMenuKeyboard(ctx.from?.id),
    });
  });

  // Handle "Suggest episode" button (from text menu)
  bot.hears(RU.bot.mainMenu.suggestEpisode, async (ctx) => {
    await ctx.reply(RU.bot.suggestEpisode.info, {
      reply_markup: getMainMenuKeyboard(ctx.from?.id), // Вернуть главное меню
    });
  });

  // Handle "Suggest episode" inline button (legacy support)
  bot.action("suggest_episode", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const callbackData = (ctx.callbackQuery as { data?: string } | undefined)?.data;
    console.log("[Bot] callback suggest_episode", {
      userId: ctx.from?.id,
      callback: callbackData,
      chatId: ctx.chat?.id,
    });
    await ctx.reply(
      RU.bot.suggestEpisode.info,
      {
        reply_markup: getMainMenuKeyboard(ctx.from?.id),
      }
    );
  });

  // /help command
  bot.help(async (ctx) => {
    const isUserAdmin = isAdmin(ctx.from?.id ?? 0);
    
    let helpText = RU.bot.help.base;

    if (isUserAdmin) {
      helpText += RU.bot.help.adminBlock;
    }

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: `${RU.bot.help.openButton}`,
            web_app: { url: config.webappUrl },
          },
        ],
      ],
    };

    // Add admin panel button for admins
    if (isUserAdmin) {
      keyboard.inline_keyboard.push([
        {
          text: `${RU.bot.help.adminButton}`,
          web_app: { url: `${config.webappUrl}/admin/scenes` },
        },
      ]);
    }

    await ctx.reply(helpText + RU.bot.help.cta, {
      reply_markup: keyboard,
    });
  });

  // /scenes - список сцен (только админ)
  bot.command("scenes", async (ctx) => {
    if (!isAdmin(ctx.from?.id ?? 0)) {
      return ctx.reply(RU.bot.errors.noAccess);
    }

    const scenes = await prisma.scene.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    if (scenes.length === 0) {
      return ctx.reply(RU.bot.scenes.noneWithHint);
    }

    const list = scenes.map((s, i) => {
      const catLabel = CATEGORY_LABELS[s.category as SceneCategory] || s.category;
      return RU.bot.scenes.listItem(i + 1, s.title, catLabel, s.durationSec, s.rolesCount, s.id);
    }).join("\n\n");

    await ctx.reply(`${RU.bot.scenes.listTitle(scenes.length)}\n\n${list}`);
  });

  // /stats - статистика (только админ)
  bot.command("stats", async (ctx) => {
    if (!isAdmin(ctx.from?.id ?? 0)) {
      return ctx.reply(RU.bot.errors.noAccess);
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
      RU.bot.stats.summary(
        totalUsers,
        totalSessions,
        todaySessions,
        completedSessions,
        conversionRate,
        scenesCount
      )
    );
  });

  // /cancel - отмена текущей операции
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
        await ctx.reply(RU.bot.cancelFlow.cancelled, {
          reply_markup: getMainMenuKeyboard(ctx.from?.id), // Всегда возвращаем главное меню
        });
      } else {
        // Даже если нет активных операций, показываем главное меню
        await ctx.reply(RU.bot.cancelFlow.mainMenu, {
          reply_markup: getMainMenuKeyboard(ctx.from?.id),
        });
      }
    }
  });

  // Handle "Admin panel" button
  bot.hears(RU.bot.mainMenu.adminPanel, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return ctx.reply(RU.bot.errors.noAccess, {
        reply_markup: getMainMenuKeyboard(userId),
      });
    }

    await ctx.reply(RU.bot.admin.openingPanel, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: RU.bot.admin.panelButton,
              web_app: { url: `${config.webappUrl}/admin/scenes` },
            },
          ],
        ],
      },
    });
  });

  // /edit_cues - редактирование таймингов сцены (только админ)
  bot.command("edit_cues", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return ctx.reply(RU.bot.errors.noAccess);
    }

    // Получаем ID сцены из аргумента или показываем список
    const args = ctx.message.text.split(" ").slice(1);
    
    if (args.length === 0) {
      // Показываем список сцен для выбора
      const scenes = await prisma.scene.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      if (scenes.length === 0) {
        return ctx.reply(RU.bot.scenes.none);
      }

      const list = scenes.map((s, i) => {
        const cues = JSON.parse(s.cueJson) as Array<{ roleIndex: number; startSec: number; durationSec: number }>;
        const cueStr = cues.map((c, j) => `${c.startSec}-${c.startSec + c.durationSec}`).join(", ");
        return RU.bot.editCues.listItem(i + 1, s.title, cueStr, s.id);
      }).join("\n\n");

      await botState.setPendingEdit(userId, {
        userId,
        sceneId: "",
        step: "awaiting_sceneId",
      });

      await ctx.reply(
        RU.bot.editCues.chooseScene(list),
        { 
          parse_mode: "Markdown",
          reply_markup: {
            keyboard: [[{ text: RU.bot.mainMenu.cancel }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
      return;
    }

    // ID сцены передан в команде
    const sceneId = args[0]!;
    await startCueEditing(ctx, userId, sceneId);
  });

  // Helper: начать редактирование cues
  async function startCueEditing(ctx: Context, userId: number, sceneId: string) {
    const scene = await prisma.scene.findUnique({ where: { id: sceneId } });

    if (!scene) {
      await ctx.reply(RU.bot.editCues.sceneNotFound(sceneId));
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
      RU.bot.editCues.editingPrompt(
        scene.title,
        scene.durationSec,
        fps,
        totalFrames,
        cueStr
      ),
      { 
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: RU.bot.mainMenu.cancel }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
  }

  // Команда для загрузки видео по URL
  bot.command("upload_url", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return ctx.reply(RU.bot.errors.noAccess);
    }

    const messageText = ctx.message.text;
    if (!messageText) {
      await ctx.reply(RU.bot.uploadUrl.emptyMessage);
      return;
    }

    const args = messageText.split(" ").slice(1);
    if (args.length === 0) {
      await ctx.reply(RU.bot.uploadUrl.usage);
      return;
    }

    const fileUrl = args[0];
    if (!fileUrl || !isValidUrl(fileUrl)) {
      await ctx.reply(RU.bot.uploadUrl.invalidUrl);
      return;
    }

    await handleVideoUrl(ctx, userId, fileUrl);
  });

  // Обработка callback для загрузки по URL
  bot.action(/^upload_url:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const callbackData = (ctx.callbackQuery as { data?: string } | undefined)?.data;
    console.log("[Bot] callback upload_url", {
      userId: ctx.from?.id,
      callback: callbackData,
      chatId: ctx.chat?.id,
    });
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return ctx.answerCbQuery(RU.bot.errors.noAccess);
    }

    const matchResult = ctx.match;
    if (!matchResult || !matchResult[1]) {
      await ctx.reply(RU.bot.uploadUrl.missingUrl);
      return;
    }

    const fileUrl = decodeURIComponent(matchResult[1]);
    await handleVideoUrl(ctx, userId, fileUrl);
  });

  // Helper: обработка загрузки видео по URL
  async function handleVideoUrl(ctx: Context, userId: number, fileUrl: string) {
    let tmpPath: string | null = null;
    try {
      await ctx.reply(RU.bot.uploadUrl.downloading);

      // Скачиваем файл по URL
      const result = await downloadFileFromUrl(fileUrl);
      tmpPath = result.path;
      const buffer = result.buffer;
      const fileSizeMb = buffer.length / (1024 * 1024);
      
      if (buffer.length === 0) {
        throw new Error("Downloaded file is empty");
      }

      console.log(`[Bot] File downloaded successfully: ${fileSizeMb.toFixed(2)} MB, path: ${tmpPath}`);
      
      await ctx.reply(RU.bot.uploadUrl.fileDownloaded(fileSizeMb.toFixed(2)));

      try {
        // Получаем информацию о видео
        const { duration, fps } = await getVideoInfo(tmpPath);
        const totalFrames = Math.round(duration * fps);
        
        console.log(`[Bot] Video info extracted: duration=${duration}s, fps=${fps}, frames=${totalFrames}`);
        
        // Удаляем временный файл (он больше не нужен, т.к. будем скачивать заново при сохранении)
        await unlink(tmpPath).catch(() => {});
        tmpPath = null;

        // Сохраняем состояние (используем fileUrl вместо fileId)
        await botState.setPendingScene(userId, {
          userId,
          fileUrl, // Сохраняем URL для последующего скачивания
          duration: Math.round(duration * 10) / 10,
          fps,
          totalFrames,
          step: "awaiting_title",
        });

        await ctx.reply(
          RU.bot.uploadUrl.videoProcessed(
            fileSizeMb.toFixed(2),
            duration.toFixed(1),
            fps.toFixed(2),
            totalFrames
          ),
          {
            reply_markup: {
              keyboard: [[{ text: RU.bot.mainMenu.cancel }]],
              resize_keyboard: true,
              one_time_keyboard: false,
            },
          }
        );
      } catch (infoErr: any) {
        console.error("[Bot] Video info extraction error:", infoErr);
        const errorMsg = infoErr.message || String(infoErr);
        
        let userMsg = `${RU.bot.uploadUrl.errorBase}\n\n`;
        
        if (errorMsg.includes("ffprobe failed")) {
          userMsg += `${RU.bot.video.processErrorFfprobe}\n`;
        } else if (errorMsg.includes("File not found")) {
          userMsg += RU.bot.uploadUrl.errorNotFound;
        } else if (errorMsg.includes("Invalid video duration")) {
          userMsg += RU.bot.video.processErrorFfprobe;
        } else {
          userMsg += RU.bot.uploadUrl.errorDetails(errorMsg.substring(0, 200));
        }
        
        await ctx.reply(userMsg);
        throw infoErr;
      }
    } catch (err: any) {
      console.error("[Bot] Video URL download error:", err);
      
      // Удаляем временный файл при ошибке
      if (tmpPath) {
        await unlink(tmpPath).catch(() => {});
      }
      
      const errorMsg = err.message || String(err);
      let userMsg = RU.bot.uploadUrl.errorBase;
      
      if (errorMsg.includes("Invalid URL")) {
        userMsg += `\n\n${RU.bot.uploadUrl.errorInvalidUrl}`;
      } else if (errorMsg.includes("404") || errorMsg.includes("Not Found")) {
        userMsg += `\n\n${RU.bot.uploadUrl.errorNotFound}`;
      } else if (errorMsg.includes("403") || errorMsg.includes("Forbidden")) {
        userMsg += `\n\n${RU.bot.uploadUrl.errorForbidden}`;
      } else if (errorMsg.includes("ffprobe") || errorMsg.includes("Invalid video")) {
        // Уже обработано выше
        return;
      } else {
        userMsg += `\n\n${RU.bot.uploadUrl.errorDetails(errorMsg.substring(0, 200))}`;
      }
      
      await ctx.reply(userMsg);
    }
  }

  // Обработка видео от админа
  bot.on(message("video"), async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return; // Игнорируем видео от не-админов
    }

    const video = ctx.message.video;
    
    // Проверка размера файла (Telegram ограничивает до ~20MB для прямого скачивания)
    const fileSizeMb = (video.file_size || 0) / (1024 * 1024);
    if (fileSizeMb > 50) {
      await ctx.reply(
        RU.bot.video.tooLargeForTelegram(fileSizeMb.toFixed(1))
      );
      return;
    }
    
    try {
      await ctx.reply(RU.bot.video.processing);

      // Скачиваем и получаем информацию
      let tmpPath: string;
      let buffer: Buffer;
      
      try {
        const result = await downloadTelegramFile(bot, video.file_id);
        tmpPath = result.path;
        buffer = result.buffer;
      } catch (downloadErr: any) {
        console.error("Download error:", downloadErr);
        
        // Если ошибка "file is too big", попробуем через файл напрямую
        if (downloadErr.response?.error_code === 400 && downloadErr.description?.includes("too big")) {
          await ctx.reply(
            RU.bot.video.tooLargeToDownload(fileSizeMb.toFixed(1))
          );
          return;
        }
        throw downloadErr;
      }

      try {
        const { duration, fps } = await getVideoInfo(tmpPath);
        const totalFrames = Math.round(duration * fps);
        
        // Удаляем временный файл
        await unlink(tmpPath).catch(() => {});

        // Сохраняем состояние
        await botState.setPendingScene(userId, {
          userId,
          fileId: video.file_id,
          duration: Math.round(duration * 10) / 10,
          fps,
          totalFrames,
          step: "awaiting_title",
        });

        await ctx.reply(
          RU.bot.video.received(duration.toFixed(1), fps, totalFrames),
          {
            reply_markup: {
              keyboard: [[{ text: RU.bot.mainMenu.cancel }]],
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
      
      let userMsg = RU.bot.video.processErrorBase;
      if (errorMsg.includes("too big") || errorMsg.includes("file is too big")) {
        userMsg += `\n\n${RU.bot.video.processErrorTooBig(fileSizeMb.toFixed(1))}`;
      } else if (errorMsg.includes("ffprobe")) {
        userMsg += `\n\n${RU.bot.video.processErrorFfprobe}`;
      } else {
        userMsg += `\n\n${RU.bot.video.processErrorDetails(errorMsg.substring(0, 100))}`;
      }
      
      await ctx.reply(userMsg);
    }
  });

  // Обработка текстовых сообщений (для диалога добавления/редактирования сцены и присоединения)
  bot.on(message("text"), async (ctx) => {
    const userId = ctx.from?.id;
    const text = ctx.message.text;

    if (!userId) return;

    // Отмена
    if (text === RU.bot.mainMenu.cancel || text.toLowerCase() === RU.bot.mainMenu.cancelPlain) {
      const [hasPendingScene, hasPendingEdit, hasPendingJoin] = await Promise.all([
        botState.getPendingScene(userId),
        botState.getPendingEdit(userId),
        botState.getPendingJoin(userId),
      ]);
      const hadPending = hasPendingScene !== null || hasPendingEdit !== null || hasPendingJoin;
      
      await botState.clearAll(userId);
      
      console.log(`[Bot] User ${userId} cancelled operation. Had pending:`, hadPending);
      
      // Всегда возвращаем главное меню после отмены
      await ctx.reply(
        hadPending ? RU.bot.cancelFlow.cancelled : RU.bot.cancelFlow.mainMenu,
        {
          reply_markup: getMainMenuKeyboard(ctx.from?.id), // Всегда возвращаем главное меню
        }
      );
      return;
    }

    // Если это админ и текст похож на URL, и нет активного диалога - предлагаем загрузить видео по URL
    const [hasPendingScene, hasPendingEdit, hasPendingJoin] = await Promise.all([
      botState.getPendingScene(userId),
      botState.getPendingEdit(userId),
      botState.getPendingJoin(userId),
    ]);
    
    if (userId && isAdmin(userId) && isValidUrl(text) && !hasPendingScene && !hasPendingEdit && !hasPendingJoin) {
      await ctx.reply(RU.bot.uploadUrl.linkDetected(text), {
        reply_markup: {
          inline_keyboard: [
            [{ text: RU.bot.uploadUrl.linkButton, callback_data: `upload_url:${encodeURIComponent(text)}` }],
          ],
        },
      });
      return;
    }

    // Проверяем, есть ли активный диалог редактирования
    const pendingEdit = hasPendingEdit || await botState.getPendingEdit(userId);
    if (pendingEdit) {
      await handleEditDialog(ctx, userId, text, pendingEdit);
      return;
    }

    // Проверяем, есть ли активный диалог добавления сцены ПЕРЕД проверкой присоединения
    // Это важно, чтобы тайминги обрабатывались правильно
    let pending = hasPendingScene || await botState.getPendingScene(userId);
    if (pending) {
      // Есть активный диалог добавления сцены, обрабатываем его (продолжим ниже)
      console.log(`[Bot] User ${userId} has pending scene, step: ${pending.step}`);
    } else if (hasPendingJoin || await botState.getPendingJoin(userId)) {
      // Только если нет активного диалога добавления сцены, обрабатываем присоединение
      const sessionCode = text.trim().toLowerCase();
      
      console.log("[Bot] Searching for session with code:", sessionCode);
      
      // Ищем сессию по ID (полному совпадению) - только активные сессии
      let session = await prisma.session.findFirst({
        where: { 
          id: sessionCode,
          status: { in: ["lobby", "recording"] }, // Только активные сессии
        },
        include: {
          participants: true,
          scene: true,
        },
      });

      // Если не нашли по полному ID, ищем по последним символам (case-insensitive)
      if (!session && sessionCode.length >= 6) {
        console.log("[Bot] Full ID not found, searching by suffix...");
        // Get all active sessions and filter in memory (Prisma doesn't support case-insensitive endsWith)
        const allSessions = await prisma.session.findMany({
          where: {
            status: { in: ["lobby", "recording"] }, // Только активные сессии
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
        // Проверяем, может сессия существует, но уже завершена
        const completedSession = await prisma.session.findFirst({
          where: { 
            id: sessionCode,
          },
          select: { id: true, status: true },
        });

        if (completedSession) {
          await ctx.reply(
            RU.bot.join.completed(completedSession.status),
            { reply_markup: getMainMenuKeyboard(ctx.from?.id) }
          );
        } else {
          await ctx.reply(
            RU.bot.join.notFound(sessionCode),
            { reply_markup: getMainMenuKeyboard(ctx.from?.id) }
          );
        }
        return;
      }

      // Проверяем, не присоединился ли уже
      const alreadyJoined = session.participants.some(p => p.tgUserId === String(userId));
      if (alreadyJoined) {
        await ctx.reply(
          RU.bot.join.alreadyJoined,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: RU.bot.join.openGame,
                    web_app: { url: `${config.webappUrl}/s/${session.id}` },
                  },
                ],
              ],
            },
          }
        );
        return;
      }

      // Проверяем, есть ли место
      if (session.participants.length >= session.maxPlayers) {
        await ctx.reply(
          RU.bot.join.full(session.maxPlayers),
          { reply_markup: { remove_keyboard: true } }
        );
        return;
      }

      // Проверяем статус - для "recording" можно присоединиться, если еще есть место
      // Но лучше разрешить только для "lobby"
      if (session.status !== "lobby" && session.status !== "recording") {
        await ctx.reply(
          RU.bot.join.closed(session.status),
          { reply_markup: getMainMenuKeyboard(ctx.from?.id) }
        );
        return;
      }
      
      // Если статус "recording", но еще есть место - можно присоединиться
      // Но для "recording" лучше не разрешать присоединение (игра уже идет)
      if (session.status === "recording") {
        await ctx.reply(
          RU.bot.join.recording,
          { reply_markup: getMainMenuKeyboard(ctx.from?.id) }
        );
        return;
      }

      // Всё ок, открываем Mini App через ссылку (не inline web_app button)
      // Inline web_app buttons имеют баг на iOS - открывают WebView вместо Mini App
      const botUsername = getNormalizedBotUsername();
      const joinLink = `https://t.me/${botUsername}?startapp=s_${session.id}`;
      await ctx.reply(
        RU.bot.join.found(
          session.participants.length,
          session.maxPlayers,
          CATEGORY_LABELS[session.category as SceneCategory] || session.category,
          joinLink
        ),
        { 
          reply_markup: getMainMenuKeyboard(ctx.from?.id),
          // Telegram auto-converts the link to a clickable button
        }
      );
      return;
    }

    // Обработка диалога добавления сцены (если pending уже определен выше)
    // Переопределяем pending на случай, если он был определен выше, но мог быть изменен
    if (!pending) {
      pending = await botState.getPendingScene(userId);
    }
    
    if (!pending) {
      console.log(`[Bot] No pending scene for user ${userId}, text:`, text);
      return; // Нет активного диалога
    }
    
    console.log(`[Bot] Processing pending scene for user ${userId}, step: ${pending.step}, text:`, text);

    // Шаг 1: Получаем название
    if (pending.step === "awaiting_title") {
      pending.title = text.trim();
      pending.step = "awaiting_category";
      await botState.setPendingScene(userId, pending);

      await ctx.reply(
        RU.bot.pendingScene.titleConfirm(pending.title),
        {
          reply_markup: {
            keyboard: [
              [{ text: RU.bot.pendingScene.categoryMovies }],
              [{ text: RU.bot.pendingScene.categoryMemes }],
              [{ text: RU.bot.pendingScene.categoryPolitics }],
              [{ text: RU.bot.mainMenu.cancel }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
      return;
    }

    // Шаг 2: Получаем категорию
    if (pending.step === "awaiting_category") {
      console.log(`[Bot] User ${userId} selecting category, text:`, text);
      console.log(`[Bot] Pending before category selection:`, { step: pending.step, title: pending.title });
      
      let category: SceneCategory;
      if (
        text.includes(RU.bot.pendingScene.matchMovies) ||
        text.includes(RU.bot.pendingScene.matchSeries) ||
        text.includes(RU.bot.pendingScene.matchMoviesEmoji)
      ) {
        category = "movies";
      } else if (
        text.includes(RU.bot.pendingScene.matchMemes) ||
        text.includes(RU.bot.pendingScene.matchMemesEmoji)
      ) {
        category = "memes";
      } else if (
        text.includes(RU.bot.pendingScene.matchPolitics) ||
        text.includes(RU.bot.pendingScene.matchPoliticsEmoji)
      ) {
        category = "politics";
      } else {
        console.log(`[Bot] Invalid category text:`, text);
        await ctx.reply(RU.bot.pendingScene.invalidCategory);
        return;
      }

      pending.category = category;
      pending.step = "awaiting_cues";
      await botState.setPendingScene(userId, pending);
      
      console.log(`[Bot] Category selected, pending saved:`, { step: pending.step, category: pending.category, userId });

      await ctx.reply(
        RU.bot.pendingScene.cuesPrompt(
          CATEGORY_LABELS[category],
          pending.totalFrames,
          pending.fps
        ),
        { 
          parse_mode: "Markdown",
          reply_markup: {
            keyboard: [[{ text: RU.bot.mainMenu.cancel }]],
            resize_keyboard: true,
            one_time_keyboard: false, // Постоянная клавиатура
          },
        }
      );
      
      // Проверяем, что состояние сохранилось
      const savedPending = await botState.getPendingScene(userId);
      console.log(`[Bot] Pending after save:`, savedPending ? { step: savedPending.step, category: savedPending.category } : "null");
      
      return;
    }

    // Шаг 3: Получаем тайминги В КАДРАХ
    if (pending.step === "awaiting_cues") {
      console.log(`[Bot] User ${userId} entered cues text:`, text);
      console.log(`[Bot] Pending state:`, { step: pending.step, title: pending.title, category: pending.category });
      
      const cues = parseCuesFrames(text);

      if (!cues || cues.length === 0) {
        console.log(`[Bot] Failed to parse cues for user ${userId}, text:`, text);
        await ctx.reply(
          RU.bot.pendingScene.cuesInvalid,
          { 
            parse_mode: "Markdown",
            reply_markup: {
              keyboard: [[{ text: RU.bot.mainMenu.cancel }]],
              resize_keyboard: true,
              one_time_keyboard: false,
            },
          }
        );
        return;
      }

      console.log(`[Bot] Successfully parsed ${cues.length} cues:`, cues);

      // Проверяем, что тайминги в пределах видео
      const maxEndFrame = Math.max(...cues.map(c => c.endFrame));
      if (maxEndFrame > pending.totalFrames + pending.fps) {
        await ctx.reply(
          RU.bot.pendingScene.cuesOutOfRange(maxEndFrame, pending.totalFrames)
        );
        return;
      }

      await ctx.reply(RU.bot.pendingScene.uploading);

      try {
        // Скачиваем видео (либо из Telegram, либо по URL)
        let buffer: Buffer;
        if (pending.fileUrl) {
          // Загружаем по URL
          console.log(`[Bot] Downloading video from URL: ${pending.fileUrl}`);
          const result = await downloadFileFromUrl(pending.fileUrl);
          buffer = result.buffer;
        } else if (pending.fileId) {
          // Загружаем из Telegram
          console.log(`[Bot] Downloading video from Telegram: ${pending.fileId}`);
          const result = await downloadTelegramFile(bot, pending.fileId);
          buffer = result.buffer;
        } else {
          throw new Error("No file source specified (fileId or fileUrl)");
        }

        // Генерируем ID сцены
        const sceneId = `scene_${Date.now()}`;
        const s3Key = `scenes/${sceneId}.mp4`;

        // Загружаем в S3
        await storage.upload(s3Key, buffer, "video/mp4");

        // Формируем cueJson В КАДРАХ (новый формат!)
        const cueJson = JSON.stringify(
          cues.map((c, i) => ({
            roleIndex: i,
            startFrame: c.startFrame,
            durationFrames: c.endFrame - c.startFrame,
          }))
        );

        // Создаём запись в базе
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

        // Очищаем состояние
        await botState.deletePendingScene(userId);

        // Показываем и кадры и секунды
        const fps = pending.fps;
        const cueInfo = cues.map((c, i) => {
          const startSec = (c.startFrame / fps).toFixed(2);
          const endSec = (c.endFrame / fps).toFixed(2);
          return RU.bot.pendingScene.cueLine(
            i + 1,
            c.startFrame,
            c.endFrame,
            startSec,
            endSec
          );
        }).join("\n");

        await ctx.reply(
          RU.bot.pendingScene.added(
            pending.title || "",
            sceneId,
            pending.duration || 0,
            fps,
            cues.length,
            cueInfo
          ),
          { reply_markup: { remove_keyboard: true } }
        );

      } catch (err) {
        console.error("Scene upload error:", err);
        await botState.deletePendingScene(userId);
        await ctx.reply(
          RU.bot.pendingScene.uploadError,
          { reply_markup: { remove_keyboard: true } }
        );
      }
    }
  });

  // Helper: обработка диалога редактирования
  async function handleEditDialog(ctx: Context, userId: number, text: string, pendingEdit: PendingEdit) {
    // Шаг 1: Выбор сцены по ID
    if (pendingEdit.step === "awaiting_sceneId") {
      const sceneId = text.trim();
      await startCueEditing(ctx, userId, sceneId);
      return;
    }

    // Шаг 2: Новые тайминги В КАДРАХ
    if (pendingEdit.step === "awaiting_new_cues" && pendingEdit.scene) {
      const cues = parseCuesFrames(text);

      if (!cues) {
        await ctx.reply(
          RU.bot.editCues.invalidFormat,
          { parse_mode: "Markdown" }
        );
        return;
      }

      // Проверяем, что тайминги в пределах видео
      const maxEndFrame = Math.max(...cues.map(c => c.endFrame));
      if (maxEndFrame > pendingEdit.scene.totalFrames + pendingEdit.scene.fps) {
        await ctx.reply(
          RU.bot.editCues.outOfRange(maxEndFrame, pendingEdit.scene.totalFrames)
        );
        return;
      }

      try {
        // Формируем новый cueJson В КАДРАХ
        const cueJson = JSON.stringify(
          cues.map((c, i) => ({
            roleIndex: i,
            startFrame: c.startFrame,
            durationFrames: c.endFrame - c.startFrame,
          }))
        );

        // Обновляем сцену
        await prisma.scene.update({
          where: { id: pendingEdit.sceneId },
          data: {
            cueJson,
            rolesCount: cues.length,
          },
        });

        await botState.deletePendingEdit(userId);

        // Показываем и кадры и секунды
        const fps = pendingEdit.scene.fps;
        const cueInfo = cues.map((c, i) => {
          const startSec = (c.startFrame / fps).toFixed(2);
          const endSec = (c.endFrame / fps).toFixed(2);
          return RU.bot.editCues.cueLine(
            i + 1,
            c.startFrame,
            c.endFrame,
            startSec,
            endSec
          );
        }).join("\n");

        await ctx.reply(
          RU.bot.editCues.updated(pendingEdit.scene.title, cues.length, cueInfo),
          { reply_markup: { remove_keyboard: true } }
        );

      } catch (err) {
        console.error("Cue update error:", err);
        await botState.deletePendingEdit(userId);
        await ctx.reply(
          RU.bot.editCues.updateError,
          { reply_markup: { remove_keyboard: true } }
        );
      }
    }
  }

  // Error handling
  bot.catch((err, ctx) => {
    console.error("Bot error:", err);
    ctx.reply(RU.bot.errors.generic).catch(() => {});
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
        caption: RU.bot.sendToCreator.caption(config.botUsername, sessionId),
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: RU.bot.sendToCreator.shareButton,
                switch_inline_query: RU.bot.sendToCreator.shareQuery(config.botUsername, sessionId),
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

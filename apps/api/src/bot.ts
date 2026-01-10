import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { storage } from "./lib/storage.js";
import { botState } from "./lib/bot-state.js";
import { spawn } from "child_process";
import { writeFile, unlink, mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";

// Categories imported from config
import { SCENE_CATEGORIES, CATEGORY_LABELS, type SceneCategory } from "./config/categories.js";

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

async function getVideoInfo(filePath: string): Promise<{ duration: number; fps: number }> {
  return new Promise((resolve, reject) => {
    // Проверяем, что файл существует
    import("fs").then((fs) => {
      fs.stat(filePath, (statErr, stats) => {
        if (statErr || !stats || stats.size === 0) {
          reject(new Error(`File not found or empty: ${filePath}`));
          return;
        }

        console.log(`[Bot] Analyzing video file: ${filePath}, size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);

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
                console.error(`[Bot] Invalid ffprobe output:`, json);
                reject(new Error("Invalid ffprobe output: missing stream or format. File may not be a valid video."));
                return;
              }

              const duration = parseFloat(format.duration || stream.duration || "0");
              if (isNaN(duration) || duration <= 0) {
                console.error(`[Bot] Invalid duration:`, format.duration, stream.duration);
                reject(new Error(`Invalid video duration: ${format.duration || stream.duration || "unknown"}`));
                return;
              }

              const frameRate = stream.r_frame_rate?.split("/");
              let fps = frameRate && frameRate.length === 2
                ? parseFloat(frameRate[0]) / parseFloat(frameRate[1])
                : 30;

              if (isNaN(fps) || fps <= 0) {
                console.warn(`[Bot] Invalid FPS, using default 30. r_frame_rate:`, stream.r_frame_rate);
                fps = 30;
              }

              console.log(`[Bot] Video info: duration=${duration.toFixed(2)}s, fps=${fps.toFixed(2)}, codec=${stream.codec_name || "unknown"}`);

              resolve({ duration, fps });
            } catch (e) {
              console.error(`[Bot] Failed to parse ffprobe output:`, e, "Output:", stdout);
              reject(new Error(`Failed to parse ffprobe output: ${e instanceof Error ? e.message : String(e)}`));
            }
          } else {
            console.error(`[Bot] ffprobe failed with code ${code}. stderr:`, stderr, "stdout:", stdout);
            reject(new Error(`ffprobe failed (code ${code}): ${stderr || "unknown error"}`));
          }
        });

        ffprobe.on("error", (err) => {
          console.error(`[Bot] ffprobe spawn error:`, err);
          reject(new Error(`Failed to run ffprobe: ${err.message}. Make sure ffprobe is installed.`));
        });
      });
    });
  });
}

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
  console.log(`[Bot] Downloading file from URL: ${fileUrl}`);
  
  // Проверяем, что это валидный URL
  try {
    const url = new URL(fileUrl);
    
    // Проверяем, что это не ссылка на страницу (например, Яндекс.Диск)
    if (url.hostname.includes('yandex.ru') || url.hostname.includes('disk.yandex')) {
      throw new Error("Yandex.Disk link detected. Please provide direct download link. For Yandex.Disk: right-click on file → 'Get link' → copy direct link, or use /d/ link.");
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
  
  console.log(`[Bot] Response headers: content-type=${contentType}, content-length=${contentLength}`);
  
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
  
  console.log(`[Bot] File downloaded: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB`);
  
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

  console.log("[Bot] Parsing cues from text:", text.substring(0, 200));

  for (const line of lines) {
    console.log("[Bot] Processing line:", line);
    
    // Формат 1: "Игрок N — startFrame - endFrame" или "Игрок N — startFrame - endFrame"
    // Поддерживаем разные типы дефисов: — (em-dash), – (en-dash), - (hyphen)
    let match = line.match(/(?:Игрок|Player|Роль|Реплика|Ролик)\s*\d+\s*[—–\-]\s*(\d+)\s*[—–\-]\s*(\d+)/i);
    if (match) {
      const startFrame = parseInt(match[1]!, 10);
      const endFrame = parseInt(match[2]!, 10);
      console.log("[Bot] Matched format 1:", { startFrame, endFrame });
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
      console.log("[Bot] Matched format 2:", { startFrame, endFrame });
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
        console.log("[Bot] Matched format 3:", { startFrame, endFrame });
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
      console.log("[Bot] Matched format 4:", { startFrame, endFrame });
      if (!isNaN(startFrame) && !isNaN(endFrame) && startFrame < endFrame) {
        cues.push({ startFrame, endFrame });
      }
    }
  }

  console.log("[Bot] Parsed cues:", cues);

  // Сортировать по startFrame
  cues.sort((a, b) => a.startFrame - b.startFrame);

  return cues.length > 0 ? cues : null;
}

export function createBot(): Telegraf {
  const bot = new Telegraf(config.botToken);

  // Main menu keyboard - всегда отображается внизу
  const mainMenuKeyboard = {
    keyboard: [
      [
        { text: "🎭 Начать игру" },
        { text: "👥 Присоединиться к игре" },
      ],
      [
        { text: "💡 Предложить эпизод" },
      ],
    ],
    resize_keyboard: true,
    persistent: true, // Постоянная клавиатура
  };

  // /start command - with optional deep link parameter
  bot.start(async (ctx) => {
    const startPayload = ctx.startPayload;
    const userId = ctx.from?.id;

    console.log("[Bot] /start command received", { userId, startPayload });

    const webAppUrl = startPayload
      ? `${config.webappUrl}/s/${startPayload}`
      : config.webappUrl;

    console.log("[Bot] WebApp URL:", webAppUrl);

    const welcomeText = `🎤 Злобная озвучка - это игра, в которой вы озвучиваете эпизоды из кино, сериалов, мемов и прочих роликов.

🎮 Выберите количество игроков - можно сыграть одному и озвучить все реплики самостоятельно или же пригласить друга и сыграть вдвоем.

🎬 Выберите категорию "Кино и сериалы", "Мемы" или "Политика" - вам случайным образом попадется эпизод из выбранного набора. Для того, чтобы озвучить другой эпизод - закончите озвучку и начните игру заново.

❗️ Далее режим - можно озвучивать свободно или же озвучивать по случайно выпавшему заданию.

▶️ Просмотрите эпизод придумайте свою версию озвучки и запишите ее. Обращайте внимание на длительность вашей роли и подгоняйте свои реплики, чтобы вписаться в тайминги!

✅ Наслаждайтесь результатом, да прибудет с вами креатив и искрометный юмор!

❤️ Каждый игрок может добавить свой эпизод в игру! Нажмите кнопку "Предложить эпизод" и следуйте инструкции.

👇 Используйте меню внизу для навигации.`;

    // Send response immediately with persistent keyboard
    try {
      if (startPayload) {
        // Deep link - open web app directly
        await ctx.reply(welcomeText, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🎮 Открыть игру",
                  web_app: { url: webAppUrl },
                },
              ],
            ],
          },
        });
      } else {
        // Regular start - show menu
        await ctx.reply(welcomeText, {
          reply_markup: mainMenuKeyboard,
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
        const userName = ctx.from?.first_name || "Аноним";
        const userLink = ctx.from?.username ? `@${ctx.from.username}` : `ID: ${userId}`;
        bot.telegram.sendMessage(
          config.notifyChannelId,
          `👤 Новый пользователь!\n\n${userName} (${userLink})`
        ).catch((err) => {
          // Silently ignore - channel notification is not critical
          console.error("Failed to notify channel:", err.message);
        });
      }, 100);
    }
  });

  // Handle "Join game" button (from text menu)
  bot.hears("👥 Присоединиться к игре", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    
    console.log("[Bot] Join game button clicked", { userId });

    const botUsername = config.botUsername;
    const instructionText = `Код для присоединения: xxxxxxx

1. Открой бота @${botUsername}
2. Нажми "👥 Присоединиться к игре"
3. Введи код: xxxxxxxxx`;

    pendingJoins.set(userId, true);
    await ctx.reply(instructionText, {
      reply_markup: {
        keyboard: [
          [{ text: "❌ Отмена" }],
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

      const botUsername = config.botUsername;
      const instructionText = `Код для присоединения: xxxxxxx

1. Открой бота @${botUsername}
2. Нажми "👥 Присоединиться к игре"
3. Введи код: xxxxxxxxx`;

      await botState.setPendingJoin(userId);
      await ctx.reply(instructionText, {
        reply_markup: {
          keyboard: [
            [{ text: "❌ Отмена" }],
          ],
          resize_keyboard: true,
          one_time_keyboard: false,
        },
      });
    } catch (err) {
      console.error("[Bot] Error in join_game handler:", err);
      await ctx.answerCbQuery("Произошла ошибка").catch(() => {});
    }
  });

  // /join command - same as clicking "Join game" button
  bot.command("join", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const botUsername = config.botUsername;
    const instructionText = `Код для присоединения: xxxxxxx

1. Открой бота @${botUsername}
2. Нажми "👥 Присоединиться к игре"
3. Введи код: xxxxxxxxx`;

    pendingJoins.set(userId, true);
    await ctx.reply(instructionText, {
      reply_markup: {
        keyboard: [[{ text: "❌ Отмена" }]],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    });
  });

  // Handle "Start game" button (from text menu)
  bot.hears("🎭 Начать игру", async (ctx) => {
    const webAppUrl = config.webappUrl;
    await ctx.reply("Открываю игру...", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🎮 Открыть игру",
              web_app: { url: webAppUrl },
            },
          ],
        ],
      },
    });
  });

  // Handle "Suggest episode" button (from text menu)
  bot.hears("💡 Предложить эпизод", async (ctx) => {
    await ctx.reply(
      `💡 Предложить эпизод\n\n` +
      `Для того, чтобы предложить эпизод, скиньте видео или ссылку на желаемый фрагмент ` +
      `и тайминги реплик, которые вы хотели бы озвучить на данный телеграм:\n\n` +
      `👉 https://t.me/skameeckaa`,
      {
        reply_markup: mainMenuKeyboard, // Вернуть главное меню
      }
    );
  });

  // Handle "Suggest episode" inline button (legacy support)
  bot.action("suggest_episode", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `💡 Предложить эпизод\n\n` +
      `Для того, чтобы предложить эпизод, скиньте видео или ссылку на желаемый фрагмент ` +
      `и тайминги реплик, которые вы хотели бы озвучить на данный телеграм:\n\n` +
      `👉 https://t.me/skameeckaa`,
      {
        reply_markup: mainMenuKeyboard, // Вернуть главное меню
      }
    );
  });

  // /help command
  bot.help(async (ctx) => {
    const isUserAdmin = isAdmin(ctx.from?.id ?? 0);
    
    let helpText = "🎬 DubDub — игра для озвучки видео\n\n" +
      "1. Создай сессию и пригласи друзей\n" +
      "2. Каждый игрок записывает реплику\n" +
      "3. Следующий игрок слышит только часть предыдущей записи\n" +
      "4. В конце получаете смешное видео!\n\n";

    if (isUserAdmin) {
      helpText += "👑 Админ-команды:\n" +
        "/scenes — список сцен\n" +
        "/edit_cues — редактировать тайминги\n" +
        "/stats — статистика\n" +
        "Отправь видео — добавить новую сцену\n\n";
    }

    await ctx.reply(helpText + "Нажми кнопку ниже, чтобы начать 👇", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🎭 Открыть DubDub",
              web_app: { url: config.webappUrl },
            },
          ],
        ],
      },
    });
  });

  // /scenes - список сцен (только админ)
  bot.command("scenes", async (ctx) => {
    if (!isAdmin(ctx.from?.id ?? 0)) {
      return ctx.reply("⛔ Нет доступа");
    }

    const scenes = await prisma.scene.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    if (scenes.length === 0) {
      return ctx.reply("Сцен пока нет. Отправь видео, чтобы добавить.");
    }

    const list = scenes.map((s, i) => {
      const catLabel = CATEGORY_LABELS[s.category as SceneCategory] || s.category;
      return `${i + 1}. ${s.title}\n   ${catLabel}\n   📹 ${s.durationSec}s, ${s.rolesCount} реплик\n   🆔 ${s.id}`;
    }).join("\n\n");

    await ctx.reply(`📋 Сцены (${scenes.length}):\n\n${list}`);
  });

  // /stats - статистика (только админ)
  bot.command("stats", async (ctx) => {
    if (!isAdmin(ctx.from?.id ?? 0)) {
      return ctx.reply("⛔ Нет доступа");
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
      `📊 Статистика DubDub\n\n` +
      `👥 Игроков: ${totalUsers}\n` +
      `🎬 Всего сессий: ${totalSessions}\n` +
      `📅 Сегодня: ${todaySessions}\n` +
      `✅ Завершено: ${completedSessions} (${conversionRate}%)\n` +
      `🎥 Сцен: ${scenesCount}`
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
        await ctx.reply("❌ Операция отменена", {
          reply_markup: mainMenuKeyboard, // Всегда возвращаем главное меню
        });
      } else {
        // Даже если нет активных операций, показываем главное меню
        await ctx.reply("Главное меню", {
          reply_markup: mainMenuKeyboard,
        });
      }
    }
  });

  // /edit_cues - редактирование таймингов сцены (только админ)
  bot.command("edit_cues", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return ctx.reply("⛔ Нет доступа");
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
        return ctx.reply("Сцен пока нет.");
      }

      const list = scenes.map((s, i) => {
        const cues = JSON.parse(s.cueJson) as Array<{ roleIndex: number; startSec: number; durationSec: number }>;
        const cueStr = cues.map((c, j) => `${c.startSec}-${c.startSec + c.durationSec}`).join(", ");
        return `${i + 1}. *${s.title}*\n   Тайминги: \`${cueStr}\`\n   ID: \`${s.id}\``;
      }).join("\n\n");

      await botState.setPendingEdit(userId, {
        userId,
        sceneId: "",
        step: "awaiting_sceneId",
      });

      await ctx.reply(
        `🎬 Выбери сцену для редактирования:\n\n${list}\n\nОтправь ID сцены:`,
        { 
          parse_mode: "Markdown",
          reply_markup: {
            keyboard: [[{ text: "❌ Отмена" }]],
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
      await ctx.reply(`❌ Сцена "${sceneId}" не найдена`);
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
      `🎬 Редактирование: *${scene.title}*\n\n` +
      `⏱ Длительность: ${scene.durationSec}s\n` +
      `🎞 FPS: ${fps}\n` +
      `📊 Всего кадров: ${totalFrames}\n` +
      `📍 Текущие тайминги (в кадрах): \`${cueStr}\`\n\n` +
      `Введи новые тайминги В КАДРАХ:\n` +
      `\`0-125, 150-275\``,
      { 
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "❌ Отмена" }]],
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
      return ctx.reply("⛔ Нет доступа");
    }

    const messageText = ctx.message.text;
    if (!messageText) {
      await ctx.reply("❌ Ошибка: пустое сообщение");
      return;
    }

    const args = messageText.split(" ").slice(1);
    if (args.length === 0) {
      await ctx.reply(
        `🔗 Загрузка видео по ссылке\n\n` +
        `Использование: /upload_url <URL>\n\n` +
        `Пример:\n` +
        `/upload_url https://example.com/video.mp4\n\n` +
        `Или просто отправь ссылку боту, и он предложит загрузить.`
      );
      return;
    }

    const fileUrl = args[0];
    if (!fileUrl || !isValidUrl(fileUrl)) {
      await ctx.reply("❌ Неверный URL. Используй http:// или https://");
      return;
    }

    await handleVideoUrl(ctx, userId, fileUrl);
  });

  // Обработка callback для загрузки по URL
  bot.action(/^upload_url:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return ctx.answerCbQuery("⛔ Нет доступа");
    }

    await ctx.answerCbQuery();
    const matchResult = ctx.match;
    if (!matchResult || !matchResult[1]) {
      await ctx.reply("❌ Ошибка: не удалось получить URL");
      return;
    }

    const fileUrl = decodeURIComponent(matchResult[1]);
    await handleVideoUrl(ctx, userId, fileUrl);
  });

  // Helper: обработка загрузки видео по URL
  async function handleVideoUrl(ctx: Context, userId: number, fileUrl: string) {
    let tmpPath: string | null = null;
    try {
      await ctx.reply("⏳ Скачиваю видео по ссылке...");

      // Скачиваем файл по URL
      const result = await downloadFileFromUrl(fileUrl);
      tmpPath = result.path;
      const buffer = result.buffer;
      const fileSizeMb = buffer.length / (1024 * 1024);
      
      if (buffer.length === 0) {
        throw new Error("Downloaded file is empty");
      }

      console.log(`[Bot] File downloaded successfully: ${fileSizeMb.toFixed(2)} MB, path: ${tmpPath}`);
      
      await ctx.reply(`📥 Файл скачан (${fileSizeMb.toFixed(2)} MB). Анализирую видео...`);

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
          `✅ Видео обработано!\n\n` +
          `📦 Размер: ${fileSizeMb.toFixed(2)} MB\n` +
          `⏱ Длительность: ${duration.toFixed(1)} сек\n` +
          `🎞 FPS: ${fps.toFixed(2)}\n` +
          `📊 Всего кадров: ${totalFrames}\n\n` +
          `Введи название сцены:`,
          {
            reply_markup: {
              keyboard: [[{ text: "❌ Отмена" }]],
              resize_keyboard: true,
              one_time_keyboard: false,
            },
          }
        );
      } catch (infoErr: any) {
        console.error("[Bot] Video info extraction error:", infoErr);
        const errorMsg = infoErr.message || String(infoErr);
        
        let userMsg = "❌ Не удалось обработать видео.\n\n";
        
        if (errorMsg.includes("ffprobe failed")) {
          userMsg += `⚠️ Файл не является валидным видео или поврежден.\n\n`;
          userMsg += `Проверь:\n`;
          userMsg += `• Файл в формате MP4, AVI, MOV и т.д.\n`;
          userMsg += `• Файл не поврежден\n`;
          userMsg += `• Файл содержит видео поток\n`;
        } else if (errorMsg.includes("File not found")) {
          userMsg += `⚠️ Файл не найден после скачивания.`;
        } else if (errorMsg.includes("Invalid video duration")) {
          userMsg += `⚠️ Не удалось определить длительность видео.\n`;
          userMsg += `Возможно, файл не является валидным видео.`;
        } else {
          userMsg += `Детали: ${errorMsg.substring(0, 200)}`;
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
      let userMsg = "❌ Ошибка загрузки видео по ссылке.";
      
      if (errorMsg.includes("Invalid URL")) {
        userMsg += "\n\n⚠️ Неверный формат URL.";
      } else if (errorMsg.includes("404") || errorMsg.includes("Not Found")) {
        userMsg += "\n\n⚠️ Файл не найден по этой ссылке.";
      } else if (errorMsg.includes("403") || errorMsg.includes("Forbidden")) {
        userMsg += "\n\n⚠️ Нет доступа к файлу по этой ссылке.";
      } else if (errorMsg.includes("ffprobe") || errorMsg.includes("Invalid video")) {
        // Уже обработано выше
        return;
      } else {
        userMsg += `\n\nДетали: ${errorMsg.substring(0, 200)}`;
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
        `❌ Видео слишком большое (${fileSizeMb.toFixed(1)} MB).\n\n` +
        `Telegram ограничивает размер файлов для прямого скачивания.\n` +
        `Попробуй сжать видео или используй файл до 50 MB.`
      );
      return;
    }
    
    try {
      await ctx.reply("⏳ Обрабатываю видео...");

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
            `❌ Видео слишком большое для скачивания через Telegram.\n\n` +
            `📦 Размер: ${fileSizeMb.toFixed(1)} MB\n\n` +
            `💡 Решения:\n` +
            `1. Сжать видео перед отправкой\n` +
            `2. Использовать видео до 20-30 MB\n` +
            `3. Загрузить напрямую на сервер через SCP/FTP`
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
          `📹 Видео получено!\n` +
          `⏱ Длительность: ${duration.toFixed(1)} сек\n` +
          `🎞 FPS: ${fps}\n` +
          `📊 Всего кадров: ${totalFrames}\n\n` +
          `Введи название сцены:`,
          {
            reply_markup: {
              keyboard: [[{ text: "❌ Отмена" }]],
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
      
      let userMsg = "❌ Ошибка обработки видео.";
      if (errorMsg.includes("too big") || errorMsg.includes("file is too big")) {
        userMsg += `\n\n📦 Файл слишком большой (${fileSizeMb.toFixed(1)} MB).`;
        userMsg += `\nПопробуй сжать видео или используй файл до 20-30 MB.`;
      } else if (errorMsg.includes("ffprobe")) {
        userMsg += `\n\n⚠️ Не удалось определить параметры видео.`;
        userMsg += `\nПроверь, что видео в формате MP4 и не повреждено.`;
      } else {
        userMsg += `\n\nДетали: ${errorMsg.substring(0, 100)}`;
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
    if (text === "❌ Отмена" || text.toLowerCase() === "отмена") {
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
        hadPending ? "❌ Операция отменена" : "Главное меню",
        {
          reply_markup: mainMenuKeyboard, // Всегда возвращаем главное меню
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
      await ctx.reply(
        `🔗 Найдена ссылка на файл!\n\n` +
        `Хочешь загрузить видео по этой ссылке?\n\n` +
        `Используй команду: /upload_url ${text}\n\n` +
        `Или нажми кнопку ниже:`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Загрузить по ссылке", callback_data: `upload_url:${encodeURIComponent(text)}` }],
            ],
          },
        }
      );
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
            `❌ Эта игра уже завершена.\n\n` +
            `Статус: ${completedSession.status}\n\n` +
            `Создай новую игру или присоединись к активной.`,
            { reply_markup: mainMenuKeyboard }
          );
        } else {
          await ctx.reply(
            `❌ Сессия с кодом "${sessionCode}" не найдена.\n\n` +
            `Проверьте код и попробуйте ещё раз.`,
            { reply_markup: mainMenuKeyboard }
          );
        }
        return;
      }

      // Проверяем, не присоединился ли уже
      const alreadyJoined = session.participants.some(p => p.tgUserId === String(userId));
      if (alreadyJoined) {
        await ctx.reply(
          `✅ Вы уже в этой игре!\n\n` +
          `Нажмите кнопку ниже, чтобы открыть игру:`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "🎮 Открыть игру",
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
          `❌ Игра уже полная (${session.maxPlayers}/${session.maxPlayers} игроков).`,
          { reply_markup: { remove_keyboard: true } }
        );
        return;
      }

      // Проверяем статус - для "recording" можно присоединиться, если еще есть место
      // Но лучше разрешить только для "lobby"
      if (session.status !== "lobby" && session.status !== "recording") {
        await ctx.reply(
          `❌ Игра уже завершена (статус: ${session.status}).\n\n` +
          `Создай новую игру или присоединись к активной.`,
          { reply_markup: mainMenuKeyboard }
        );
        return;
      }
      
      // Если статус "recording", но еще есть место - можно присоединиться
      // Но для "recording" лучше не разрешать присоединение (игра уже идет)
      if (session.status === "recording") {
        await ctx.reply(
          `❌ Игра уже началась. Можно присоединиться только к играм в лобби.`,
          { reply_markup: mainMenuKeyboard }
        );
        return;
      }

      // Всё ок, открываем Mini App
      await ctx.reply(
        `✅ Найдена игра!\n\n` +
        `Игроков: ${session.participants.length}/${session.maxPlayers}\n` +
        `Категория: ${CATEGORY_LABELS[session.category as SceneCategory] || session.category}\n\n` +
        `Нажмите кнопку, чтобы присоединиться:`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🎮 Присоединиться",
                  web_app: { url: `${config.webappUrl}/s/${session.id}` },
                },
              ],
            ],
          },
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
        `👍 Название: "${pending.title}"\n\n` +
        `Выбери категорию:`,
        {
          reply_markup: {
            keyboard: [
              [{ text: "🎬 Кино/сериалы" }],
              [{ text: "😂 Мемы" }],
              [{ text: "🏛️ Политика" }],
              [{ text: "❌ Отмена" }],
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
      if (text.includes("Кино") || text.includes("сериал") || text.includes("🎬")) {
        category = "movies";
      } else if (text.includes("Мем") || text.includes("😂")) {
        category = "memes";
      } else if (text.includes("Полит") || text.includes("🏛️")) {
        category = "politics";
      } else {
        console.log(`[Bot] Invalid category text:`, text);
        await ctx.reply("❌ Выбери категорию из кнопок");
        return;
      }

      pending.category = category;
      pending.step = "awaiting_cues";
      await botState.setPendingScene(userId, pending);
      
      console.log(`[Bot] Category selected, pending saved:`, { step: pending.step, category: pending.category, userId });

      await ctx.reply(
        `👍 Категория: ${CATEGORY_LABELS[category]}\n\n` +
        `Теперь введи тайминги реплик В КАДРАХ.\n\n` +
        `📝 Поддерживаемые форматы:\n` +
        `• \`0-125, 150-275\` (обычный)\n` +
        `• \`Игрок 1 — 280 - 367\`\n` +
        `• \`Игрок 2 — 787 - 922\`\n\n` +
        `📊 Всего кадров: ${pending.totalFrames}\n` +
        `🎞 FPS: ${pending.fps}\n\n` +
        `Можно указать все реплики одной строкой или по одной на строку.`,
        { 
          parse_mode: "Markdown",
          reply_markup: {
            keyboard: [[{ text: "❌ Отмена" }]],
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
          "❌ Неверный формат таймингов.\n\n" +
          "📝 Используй один из форматов:\n" +
          "• `0-125, 150-275` (обычный)\n" +
          "• `Игрок 1 — 280 - 367` (с префиксом)\n" +
          "• `Игрок 2 — 787 - 922`\n\n" +
          "Можно указать все реплики одной строкой или по одной на строку.\n\n" +
          "Попробуй ещё раз:",
          { 
            parse_mode: "Markdown",
            reply_markup: {
              keyboard: [[{ text: "❌ Отмена" }]],
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
          `❌ Кадр ${maxEndFrame} выходит за пределы видео (${pending.totalFrames} кадров).\n` +
          `Попробуй ещё раз:`
        );
        return;
      }

      await ctx.reply("⏳ Загружаю видео в хранилище...");

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
          return `  Игрок ${i + 1}: кадры ${c.startFrame}-${c.endFrame} (${startSec}s — ${endSec}s)`;
        }).join("\n");

        await ctx.reply(
          `✅ Сцена добавлена!\n\n` +
          `📝 Название: ${pending.title}\n` +
          `🆔 ID: ${sceneId}\n` +
          `⏱ Длительность: ${pending.duration}s\n` +
          `🎞 FPS: ${fps}\n` +
          `🎭 Реплик: ${cues.length}\n\n` +
          `Тайминги:\n${cueInfo}`,
          { reply_markup: { remove_keyboard: true } }
        );

      } catch (err) {
        console.error("Scene upload error:", err);
        await botState.deletePendingScene(userId);
        await ctx.reply(
          "❌ Ошибка загрузки. Попробуй ещё раз.",
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
          "❌ Неверный формат. Используй ЦЕЛЫЕ числа (кадры): `0-125, 150-275`\n" +
          "Попробуй ещё раз:",
          { parse_mode: "Markdown" }
        );
        return;
      }

      // Проверяем, что тайминги в пределах видео
      const maxEndFrame = Math.max(...cues.map(c => c.endFrame));
      if (maxEndFrame > pendingEdit.scene.totalFrames + pendingEdit.scene.fps) {
        await ctx.reply(
          `❌ Кадр ${maxEndFrame} выходит за пределы видео (${pendingEdit.scene.totalFrames} кадров).\n` +
          `Попробуй ещё раз:`
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
          return `  Игрок ${i + 1}: кадры ${c.startFrame}-${c.endFrame} (${startSec}s — ${endSec}s)`;
        }).join("\n");

        await ctx.reply(
          `✅ Тайминги обновлены!\n\n` +
          `📝 Сцена: ${pendingEdit.scene.title}\n` +
          `🎭 Реплик: ${cues.length}\n\n` +
          `Новые тайминги:\n${cueInfo}`,
          { reply_markup: { remove_keyboard: true } }
        );

      } catch (err) {
        console.error("Cue update error:", err);
        await botState.deletePendingEdit(userId);
        await ctx.reply(
          "❌ Ошибка обновления. Попробуй ещё раз.",
          { reply_markup: { remove_keyboard: true } }
        );
      }
    }
  }

  // Error handling
  bot.catch((err, ctx) => {
    console.error("Bot error:", err);
    ctx.reply("Произошла ошибка. Попробуйте позже.").catch(() => {});
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
        caption: "🎬 Ваш дубляж готов!\n\n" +
          `Поделитесь с друзьями: t.me/${config.botUsername}?startapp=${sessionId}`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📤 Поделиться",
                switch_inline_query: `Смотри наш дубляж! t.me/${config.botUsername}?startapp=${sessionId}`,
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

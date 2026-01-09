import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { storage } from "./lib/storage.js";
import { spawn } from "child_process";
import { writeFile, unlink, mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";

// Категории сцен
const SCENE_CATEGORIES = ["movies", "memes", "politics"] as const;
type SceneCategory = typeof SCENE_CATEGORIES[number];

const CATEGORY_LABELS: Record<SceneCategory, string> = {
  movies: "🎬 Кино/сериалы",
  memes: "😂 Мемы",
  politics: "🏛️ Политика",
};

// Состояние диалога для добавления сцен
interface PendingScene {
  userId: number;
  fileId: string;
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

const pendingScenes = new Map<number, PendingScene>();
const pendingEdits = new Map<number, PendingEdit>();

function isAdmin(userId: number): boolean {
  return config.adminTgUserIds.includes(String(userId));
}

async function getVideoInfo(filePath: string): Promise<{ duration: number; fps: number }> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=r_frame_rate,duration:format=duration",
      "-of", "json",
      filePath,
    ]);

    let output = "";
    ffprobe.stdout.on("data", (data) => {
      output += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        try {
          const json = JSON.parse(output);
          // Get duration from format or stream
          const duration = parseFloat(json.format?.duration || json.streams?.[0]?.duration || "0");
          
          // Parse fps from r_frame_rate (e.g., "25/1" or "30000/1001")
          const fpsStr = json.streams?.[0]?.r_frame_rate || "25/1";
          const [num, den] = fpsStr.split("/").map(Number);
          const fps = den ? num / den : 25;
          
          resolve({ duration, fps: Math.round(fps * 100) / 100 });
        } catch {
          resolve({ duration: 0, fps: 25 });
        }
      } else {
        reject(new Error("ffprobe failed"));
      }
    });
  });
}

async function downloadTelegramFile(
  bot: Telegraf,
  fileId: string
): Promise<{ buffer: Buffer; path: string }> {
  const fileLink = await bot.telegram.getFileLink(fileId);
  const response = await fetch(fileLink.href);
  const buffer = Buffer.from(await response.arrayBuffer());
  
  const tmpDir = path.join(os.tmpdir(), "dubdub-uploads");
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `${randomUUID()}.mp4`);
  await writeFile(tmpPath, buffer);
  
  return { buffer, path: tmpPath };
}

/**
 * Parse cues in FRAMES format: "0-125, 150-275" (integers)
 */
function parseCuesFrames(text: string): Array<{ startFrame: number; endFrame: number }> | null {
  // Форматы: "0-125, 150-275" или "0-125 150-275"
  const parts = text.split(/[,\s]+/).filter(Boolean);
  const cues: Array<{ startFrame: number; endFrame: number }> = [];

  for (const part of parts) {
    const match = part.match(/^(\d+)-(\d+)$/);
    if (!match) return null;
    
    const startFrame = parseInt(match[1]!, 10);
    const endFrame = parseInt(match[2]!, 10);
    
    if (isNaN(startFrame) || isNaN(endFrame) || startFrame >= endFrame) return null;
    cues.push({ startFrame, endFrame });
  }

  return cues.length > 0 ? cues : null;
}

export function createBot(): Telegraf {
  const bot = new Telegraf(config.botToken);

  // /start command - with optional deep link parameter
  bot.start(async (ctx) => {
    const startPayload = ctx.startPayload;
    const userId = ctx.from?.id;

    const webAppUrl = startPayload
      ? `${config.webappUrl}/s/${startPayload}`
      : config.webappUrl;

    const welcomeText = `🎤 Злобная озвучка - это игра, в которой вы озвучиваете эпизоды из кино, сериалов, мемов и прочих роликов.

🎮 Выберите количество игроков - можно сыграть одному и озвучить все реплики самостоятельно или же пригласить друга и сыграть вдвоем.

🎬 Выберите категорию "Кино и сериалы", "Мемы" или "Политика" - вам случайным образом попадется эпизод из выбранного набора. Для того, чтобы озвучить другой эпизод - закончите озвучку и начните игру заново.

❗️ Далее режим - можно озвучивать свободно или же озвучивать по случайно выпавшему заданию.

▶️ Просмотрите эпизод придумайте свою версию озвучки и запишите ее. Обращайте внимание на длительность вашей роли и подгоняйте свои реплики, чтобы вписаться в тайминги!

✅ Наслаждайтесь результатом, да прибудет с вами креатив и искрометный юмор!

❤️ Каждый игрок может добавить свой эпизод в игру! Нажмите кнопку "Предложить эпизод" и следуйте инструкции.`;

    await ctx.reply(welcomeText, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🎭 Начать игру",
              web_app: { url: webAppUrl },
            },
          ],
          [
            {
              text: "💡 Предложить эпизод",
              callback_data: "suggest_episode",
            },
          ],
        ],
      },
    });

    // Notify channel about new user (if not a deep link session join)
    if (!startPayload && userId && config.notifyChannelId) {
      const userName = ctx.from?.first_name || "Аноним";
      const userLink = ctx.from?.username ? `@${ctx.from.username}` : `ID: ${userId}`;
      try {
        await bot.telegram.sendMessage(
          config.notifyChannelId,
          `👤 Новый пользователь!\n\n${userName} (${userLink})`
        );
      } catch (err) {
        console.error("Failed to notify channel:", err);
      }
    }
  });

  // Handle "Suggest episode" button
  bot.action("suggest_episode", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `💡 Предложить эпизод\n\n` +
      `Для того, чтобы предложить эпизод, скиньте видео или ссылку на желаемый фрагмент ` +
      `и тайминги реплик, которые вы хотели бы озвучить на данный телеграм:\n\n` +
      `👉 https://t.me/skameeckaa`
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
      const hadPending = pendingScenes.has(userId) || pendingEdits.has(userId);
      pendingScenes.delete(userId);
      pendingEdits.delete(userId);
      if (hadPending) {
        await ctx.reply("❌ Операция отменена", {
          reply_markup: { remove_keyboard: true },
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

      pendingEdits.set(userId, {
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

    pendingEdits.set(userId, {
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

  // Обработка видео от админа
  bot.on(message("video"), async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      return; // Игнорируем видео от не-админов
    }

    const video = ctx.message.video;
    
    try {
      await ctx.reply("⏳ Обрабатываю видео...");

      // Скачиваем и получаем информацию
      const { path: tmpPath, buffer } = await downloadTelegramFile(bot, video.file_id);
      const { duration, fps } = await getVideoInfo(tmpPath);
      const totalFrames = Math.round(duration * fps);
      
      // Удаляем временный файл
      await unlink(tmpPath).catch(() => {});

      // Сохраняем состояние
      pendingScenes.set(userId, {
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
            one_time_keyboard: true,
          },
        }
      );
    } catch (err) {
      console.error("Video processing error:", err);
      await ctx.reply("❌ Ошибка обработки видео. Попробуй ещё раз.");
    }
  });

  // Обработка текстовых сообщений (для диалога добавления/редактирования сцены)
  bot.on(message("text"), async (ctx) => {
    const userId = ctx.from?.id;
    const text = ctx.message.text;

    if (!userId) return;

    // Отмена
    if (text === "❌ Отмена" || text.toLowerCase() === "отмена") {
      const hadPending = pendingScenes.has(userId) || pendingEdits.has(userId);
      pendingScenes.delete(userId);
      pendingEdits.delete(userId);
      if (hadPending) {
        await ctx.reply("❌ Отменено", {
          reply_markup: { remove_keyboard: true },
        });
      }
      return;
    }

    // Проверяем, есть ли активный диалог редактирования
    const pendingEdit = pendingEdits.get(userId);
    if (pendingEdit) {
      await handleEditDialog(ctx, userId, text, pendingEdit);
      return;
    }

    // Проверяем, есть ли активный диалог добавления сцены
    const pending = pendingScenes.get(userId);
    
    if (!pending) return; // Нет активного диалога

    // Шаг 1: Получаем название
    if (pending.step === "awaiting_title") {
      pending.title = text.trim();
      pending.step = "awaiting_category";
      pendingScenes.set(userId, pending);

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
      let category: SceneCategory;
      if (text.includes("Кино") || text.includes("сериал")) {
        category = "movies";
      } else if (text.includes("Мем")) {
        category = "memes";
      } else if (text.includes("Полит")) {
        category = "politics";
      } else {
        await ctx.reply("❌ Выбери категорию из кнопок");
        return;
      }

      pending.category = category;
      pending.step = "awaiting_cues";
      pendingScenes.set(userId, pending);

      await ctx.reply(
        `👍 Категория: ${CATEGORY_LABELS[category]}\n\n` +
        `Теперь введи тайминги реплик В КАДРАХ:\n` +
        `\`0-125, 150-275\`\n\n` +
        `Это означает (при ${pending.fps} fps):\n` +
        `• Игрок 1: кадры 0-125 (${(0/pending.fps).toFixed(2)}-${(125/pending.fps).toFixed(2)} сек)\n` +
        `• Игрок 2: кадры 150-275\n\n` +
        `📊 Всего кадров: ${pending.totalFrames}\n` +
        `🎞 FPS: ${pending.fps}`,
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

    // Шаг 3: Получаем тайминги В КАДРАХ
    if (pending.step === "awaiting_cues") {
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
      if (maxEndFrame > pending.totalFrames + pending.fps) {
        await ctx.reply(
          `❌ Кадр ${maxEndFrame} выходит за пределы видео (${pending.totalFrames} кадров).\n` +
          `Попробуй ещё раз:`
        );
        return;
      }

      await ctx.reply("⏳ Загружаю видео в хранилище...");

      try {
        // Скачиваем видео снова
        const { buffer } = await downloadTelegramFile(bot, pending.fileId);

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
        pendingScenes.delete(userId);

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
        pendingScenes.delete(userId);
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

        pendingEdits.delete(userId);

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
        pendingEdits.delete(userId);
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

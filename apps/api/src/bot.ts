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

// Состояние диалога для добавления сцен
interface PendingScene {
  userId: number;
  fileId: string;
  duration: number;
  step: "awaiting_title" | "awaiting_cues";
  title?: string;
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
    currentCues: Array<{ roleIndex: number; startSec: number; durationSec: number }>;
  };
}

const pendingScenes = new Map<number, PendingScene>();
const pendingEdits = new Map<number, PendingEdit>();

function isAdmin(userId: number): boolean {
  return config.adminTgUserIds.includes(String(userId));
}

async function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      filePath,
    ]);

    let output = "";
    ffprobe.stdout.on("data", (data) => {
      output += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        resolve(parseFloat(output.trim()) || 0);
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

function parseCues(text: string): Array<{ start: number; end: number }> | null {
  // Форматы: "1-5, 6-10, 12-16" или "1-5 6-10 12-16"
  const parts = text.split(/[,\s]+/).filter(Boolean);
  const cues: Array<{ start: number; end: number }> = [];

  for (const part of parts) {
    const match = part.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    
    const start = parseFloat(match[1]!);
    const end = parseFloat(match[2]!);
    
    if (isNaN(start) || isNaN(end) || start >= end) return null;
    cues.push({ start, end });
  }

  return cues.length > 0 ? cues : null;
}

export function createBot(): Telegraf {
  const bot = new Telegraf(config.botToken);

  // /start command - with optional deep link parameter
  bot.start(async (ctx) => {
    const startPayload = ctx.startPayload;

    const webAppUrl = startPayload
      ? `${config.webappUrl}/s/${startPayload}`
      : config.webappUrl;

    await ctx.reply("🎬 Добро пожаловать в DubDub!\n\nОзвучивай немое видео с друзьями.", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🎭 Открыть DubDub",
              web_app: { url: webAppUrl },
            },
          ],
        ],
      },
    });
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
      const cues = JSON.parse(s.cueJson) as Array<{ roleIndex: number; startSec: number; durationSec: number }>;
      return `${i + 1}. ${s.title}\n   📹 ${s.durationSec}s, ${s.rolesCount} реплик\n   🆔 ${s.id}`;
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

    const cues = JSON.parse(scene.cueJson) as Array<{ roleIndex: number; startSec: number; durationSec: number }>;
    const currentCuesStr = cues.map(c => `${c.startSec}-${c.startSec + c.durationSec}`).join(", ");

    pendingEdits.set(userId, {
      userId,
      sceneId: scene.id,
      step: "awaiting_new_cues",
      scene: {
        id: scene.id,
        title: scene.title,
        duration: scene.durationSec,
        currentCues: cues,
      },
    });

    await ctx.reply(
      `🎬 Редактирование: *${scene.title}*\n\n` +
      `⏱ Длительность видео: ${scene.durationSec}s\n` +
      `📍 Текущие тайминги: \`${currentCuesStr}\`\n\n` +
      `Введи новые тайминги в формате:\n` +
      `\`1-5, 6-10, 12-16\``,
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

      // Скачиваем и получаем длительность
      const { path: tmpPath, buffer } = await downloadTelegramFile(bot, video.file_id);
      const duration = await getVideoDuration(tmpPath);
      
      // Удаляем временный файл
      await unlink(tmpPath).catch(() => {});

      // Сохраняем состояние
      pendingScenes.set(userId, {
        userId,
        fileId: video.file_id,
        duration: Math.round(duration * 10) / 10,
        step: "awaiting_title",
      });

      await ctx.reply(
        `📹 Видео получено!\n` +
        `⏱ Длительность: ${duration.toFixed(1)} сек\n\n` +
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
      pending.step = "awaiting_cues";
      pendingScenes.set(userId, pending);

      await ctx.reply(
        `👍 Название: "${pending.title}"\n\n` +
        `Теперь введи тайминги реплик в формате:\n` +
        `\`1-5, 6-10, 12-16\`\n\n` +
        `Это означает:\n` +
        `• Игрок 1: с 1 по 5 сек\n` +
        `• Игрок 2: с 6 по 10 сек\n` +
        `• Игрок 3: с 12 по 16 сек\n\n` +
        `⏱ Длительность видео: ${pending.duration} сек`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Шаг 2: Получаем тайминги
    if (pending.step === "awaiting_cues") {
      const cues = parseCues(text);

      if (!cues) {
        await ctx.reply(
          "❌ Неверный формат. Используй: `1-5, 6-10, 12-16`\n" +
          "Попробуй ещё раз:",
          { parse_mode: "Markdown" }
        );
        return;
      }

      // Проверяем, что тайминги в пределах видео
      const maxEnd = Math.max(...cues.map(c => c.end));
      if (maxEnd > pending.duration + 1) {
        await ctx.reply(
          `❌ Тайминг ${maxEnd}s выходит за пределы видео (${pending.duration}s).\n` +
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

        // Формируем cueJson
        const cueJson = JSON.stringify(
          cues.map((c, i) => ({
            roleIndex: i,
            startSec: c.start,
            durationSec: c.end - c.start,
          }))
        );

        // Создаём запись в базе
        await prisma.scene.create({
          data: {
            id: sceneId,
            title: pending.title!,
            s3Key,
            durationSec: pending.duration,
            rolesCount: cues.length,
            cueJson,
          },
        });

        // Очищаем состояние
        pendingScenes.delete(userId);

        await ctx.reply(
          `✅ Сцена добавлена!\n\n` +
          `📝 Название: ${pending.title}\n` +
          `🆔 ID: ${sceneId}\n` +
          `⏱ Длительность: ${pending.duration}s\n` +
          `🎭 Реплик: ${cues.length}\n\n` +
          `Тайминги:\n` +
          cues.map((c, i) => `  Игрок ${i + 1}: ${c.start}s — ${c.end}s`).join("\n"),
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

    // Шаг 2: Новые тайминги
    if (pendingEdit.step === "awaiting_new_cues" && pendingEdit.scene) {
      const cues = parseCues(text);

      if (!cues) {
        await ctx.reply(
          "❌ Неверный формат. Используй: `1-5, 6-10, 12-16`\n" +
          "Попробуй ещё раз:",
          { parse_mode: "Markdown" }
        );
        return;
      }

      // Проверяем, что тайминги в пределах видео
      const maxEnd = Math.max(...cues.map(c => c.end));
      if (maxEnd > pendingEdit.scene.duration + 1) {
        await ctx.reply(
          `❌ Тайминг ${maxEnd}s выходит за пределы видео (${pendingEdit.scene.duration}s).\n` +
          `Попробуй ещё раз:`
        );
        return;
      }

      try {
        // Формируем новый cueJson
        const cueJson = JSON.stringify(
          cues.map((c, i) => ({
            roleIndex: i,
            startSec: c.start,
            durationSec: c.end - c.start,
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

        await ctx.reply(
          `✅ Тайминги обновлены!\n\n` +
          `📝 Сцена: ${pendingEdit.scene.title}\n` +
          `🎭 Реплик: ${cues.length}\n\n` +
          `Новые тайминги:\n` +
          cues.map((c, i) => `  Игрок ${i + 1}: ${c.start}s — ${c.end}s`).join("\n"),
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

const { PrismaClient } = require("@prisma/client");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

// Конфигурация из .env
const DATABASE_URL = process.env.DATABASE_URL;
const S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:9000";
const S3_REGION = process.env.S3_REGION || "us-east-1";
const S3_BUCKET = process.env.S3_BUCKET || "dubdub";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;

// Аргументы командной строки
const folderPath = process.argv[2];
const category = process.argv[3] || "memes"; // movies, memes, politics

if (!folderPath) {
  console.error("Использование: node upload-videos.js <путь_к_папке> [категория]");
  console.error("Пример: node upload-videos.js /tmp/kimo_videos movies");
  console.error("Категории: movies, memes, politics");
  process.exit(1);
}

if (!["movies", "memes", "politics"].includes(category)) {
  console.error("Неверная категория. Используйте: movies, memes, politics");
  process.exit(1);
}

if (!DATABASE_URL || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
  console.error("Ошибка: не настроены переменные окружения (DATABASE_URL, S3_ACCESS_KEY, S3_SECRET_KEY)");
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: DATABASE_URL },
  },
});

const s3Client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

/**
 * Получить длительность и FPS видео через ffprobe
 */
function getVideoInfo(filePath) {
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

    ffprobe.stderr.on("data", (data) => {
      // Игнорируем stderr для ffprobe
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        try {
          const json = JSON.parse(output);
          const duration = parseFloat(json.format?.duration || json.streams?.[0]?.duration || "0");
          
          const fpsStr = json.streams?.[0]?.r_frame_rate || "30/1";
          const [num, den] = fpsStr.split("/").map(Number);
          const fps = den ? num / den : 30;
          
          resolve({ 
            duration: Math.round(duration * 1000) / 1000, 
            fps: Math.round(fps * 100) / 100 
          });
        } catch (err) {
          reject(new Error(`Failed to parse ffprobe output: ${err.message}`));
        }
      } else {
        reject(new Error(`ffprobe exited with code ${code}`));
      }
    });

    ffprobe.on("error", (err) => {
      reject(new Error(`ffprobe error: ${err.message}`));
    });
  });
}

/**
 * Парсить тайминги из txt файла
 * Формат: "Игрок 1 — 280 - 367"
 */
function parseCuesFromTxt(txtContent, fps) {
  const lines = txtContent.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const cues = [];

  for (const line of lines) {
    // Формат: "Игрок N — startFrame - endFrame"
    let match = line.match(/(?:Игрок|Player|Роль|Реплика|Ролик)\s*(\d+)\s*[—–-]\s*(\d+)\s*[—–-]\s*(\d+)/i);
    if (match) {
      const startFrame = parseInt(match[2], 10);
      const endFrame = parseInt(match[3], 10);
      if (!isNaN(startFrame) && !isNaN(endFrame) && startFrame < endFrame) {
        cues.push({ startFrame, endFrame });
      }
      continue;
    }

    // Формат: "число - число"
    match = line.match(/^(\d+)\s*[—–-]\s*(\d+)$/);
    if (match) {
      const startFrame = parseInt(match[1], 10);
      const endFrame = parseInt(match[2], 10);
      if (!isNaN(startFrame) && !isNaN(endFrame) && startFrame < endFrame) {
        cues.push({ startFrame, endFrame });
      }
      continue;
    }
  }

  // Сортировать по startFrame
  cues.sort((a, b) => a.startFrame - b.startFrame);

  return cues.length > 0 ? cues : null;
}

/**
 * Загрузить файл в S3
 */
async function uploadToS3(key, filePath) {
  const fileBuffer = await fs.readFile(filePath);
  
  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: "video/mp4",
    })
  );
}

/**
 * Основная функция
 */
async function main() {
  console.log(`📁 Папка: ${folderPath}`);
  console.log(`📂 Категория: ${category}`);
  console.log("");

  try {
    // Проверить существование папки
    const stats = await fs.stat(folderPath);
    if (!stats.isDirectory()) {
      throw new Error(`Путь не является папкой: ${folderPath}`);
    }

    // Найти все .mp4 файлы
    const files = await fs.readdir(folderPath);
    const videoFiles = files.filter(f => f.toLowerCase().endsWith(".mp4"));

    if (videoFiles.length === 0) {
      console.error("❌ В папке не найдено .mp4 файлов");
      return;
    }

    console.log(`Найдено ${videoFiles.length} видео файлов\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const videoFile of videoFiles) {
      const videoPath = path.join(folderPath, videoFile);
      const videoName = path.parse(videoFile).name;
      const txtFile = path.join(folderPath, `${videoName}.txt`);

      console.log(`📹 Обработка: ${videoFile}`);

      try {
        // Проверить наличие txt файла
        try {
          await fs.access(txtFile);
        } catch {
          console.log(`  ⚠️  Пропущен: не найден файл ${videoName}.txt`);
          errorCount++;
          continue;
        }

        // Получить информацию о видео (нужна для парсинга времени в секундах)
        const { duration, fps } = await getVideoInfo(videoPath);

        // Прочитать тайминги
        const txtContent = await fs.readFile(txtFile, "utf-8");
        const cuesData = parseCuesFromTxt(txtContent, fps);

        if (!cuesData || cuesData.length === 0) {
          console.log(`  ⚠️  Пропущен: не удалось распарсить тайминги из ${videoName}.txt`);
          console.log(`     Содержимое файла (первые 200 символов):`);
          console.log(`     ${txtContent.substring(0, 200).replace(/\n/g, ' ')}`);
          errorCount++;
          continue;
        }

        console.log(`  ⏱  Длительность: ${duration.toFixed(2)}s, FPS: ${fps}`);
        console.log(`  📝 Найдено реплик: ${cuesData.length}`);

        // Проверить тайминги на валидность
        const totalFrames = Math.round(duration * fps);
        const maxEndFrame = Math.max(...cuesData.map(c => c.endFrame));
        if (maxEndFrame > totalFrames) {
          console.log(`  ⚠️  Предупреждение: последний кадр ${maxEndFrame} больше длины видео (${totalFrames} кадров)`);
        }

        // Создать ID сцены
        const sceneId = `scene_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const s3Key = `scenes/${sceneId}.mp4`;

        // Загрузить в S3
        console.log(`  📤 Загрузка в S3: ${s3Key}`);
        await uploadToS3(s3Key, videoPath);

        // Создать cueJson в формате кадров
        const cueJson = JSON.stringify(
          cuesData.map((c, i) => ({
            roleIndex: i,
            startFrame: c.startFrame,
            durationFrames: c.endFrame - c.startFrame,
          }))
        );

        // Добавить в базу данных
        await prisma.scene.create({
          data: {
            id: sceneId,
            title: videoName,
            category,
            s3Key,
            durationSec: duration,
            fps,
            rolesCount: cuesData.length,
            cueJson,
          },
        });

        console.log(`  ✅ Успешно добавлена сцена: ${sceneId}`);
        console.log(`     Реплик: ${cuesData.length}`);
        console.log(`     Тайминги (кадры): ${cuesData.map(c => `${c.startFrame}-${c.endFrame}`).join(", ")}`);
        console.log("");

        successCount++;
      } catch (err) {
        console.error(`  ❌ Ошибка при обработке ${videoFile}:`, err.message);
        errorCount++;
        console.log("");
      }
    }

    console.log("");
    console.log("═══════════════════════════════════");
    console.log(`✅ Успешно: ${successCount}`);
    console.log(`❌ Ошибок: ${errorCount}`);
    console.log(`📊 Всего: ${videoFiles.length}`);
  } catch (err) {
    console.error("❌ Критическая ошибка:", err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);


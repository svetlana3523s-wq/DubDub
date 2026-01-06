import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
  "Инопланетяне изучают русскую баню",
  "Судебный процесс: кот против пылесоса",
  "Первый контакт с цивилизацией грибов",
  "День рождения в бункере",
  "Собрание жильцов подводного дома",
];

async function main() {
  // Create default scene
  // Cues: 3 roles with ~4.5 second speaking time each
  const cueJson = JSON.stringify([
    { roleIndex: 0, startSec: 0.8, durationSec: 4.5 },
    { roleIndex: 1, startSec: 5.6, durationSec: 4.5 },
    { roleIndex: 2, startSec: 10.4, durationSec: 4.5 },
  ]);

  const scene = await prisma.scene.upsert({
    where: { id: "default-scene" },
    update: {},
    create: {
      id: "default-scene",
      title: "Немая сцена #1",
      s3Key: "scenes/scene1.mp4",
      durationSec: 16,
      rolesCount: 3,
      cueJson,
    },
  });

  console.log("✅ Seeded scene:", scene.id);
  console.log("📋 Available topics:", TOPICS.length);
  console.log("\n⚠️  Don't forget to upload scene1.mp4 to S3: scenes/scene1.mp4");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

export { TOPICS };


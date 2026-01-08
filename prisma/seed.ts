import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Задания для режима "С заданиями"
const TASKS = [
  "Озвучь в стиле ужастиков категории Б",
  "Озвучь КРАЙНЕ эмоционально",
  "Озвучь с кавказским акцентом",
  "Озвучь используя самое необычное нецензурное слово которое ты знаешь",
  "Озвучь в стиле укурыша",
  "Озвучь в стиле гоблина",
  "Озвучь издавая звуки животного",
  "Озвучь страстно",
  "Озвучь пошло",
  "Озвучь голосом монстра",
  "Озвучь в стиле Гитлера",
];

// Категории сцен
const CATEGORIES = {
  movies: "Кино/сериалы",
  memes: "Мемы", 
  politics: "Политика",
} as const;

async function main() {
  console.log("📋 Задания для режима 'С заданиями':", TASKS.length);
  console.log("📁 Категории:", Object.values(CATEGORIES).join(", "));
  console.log("\n⚠️  Загрузи видео через бота: отправь видео → укажи название → укажи категорию → укажи тайминги");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

export { TASKS, CATEGORIES };

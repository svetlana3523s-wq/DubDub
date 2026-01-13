export const TASKS = [
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
  "Озвучь в стиле Микки Мауса - писклявым голосом",
  "Озвучь испуганно",
  "Озвучь напевая",
  "Озвучь издавая стоны",
  "Озвучь в стиле деда который забыл выпить таблетки",
  "Озвучь в стиле японской девочки",
  "Озвучь в стиле цитат Джейсона Стэтхэма",
] as const;

// Track last used task to avoid repetition
let lastTaskIndex = -1;

export function getRandomTask(): string {
  // Get random index that's different from last used
  let newIndex: number;
  do {
    newIndex = Math.floor(Math.random() * TASKS.length);
  } while (newIndex === lastTaskIndex && TASKS.length > 1);
  
  lastTaskIndex = newIndex;
  return TASKS[newIndex] ?? TASKS[0]!;
}


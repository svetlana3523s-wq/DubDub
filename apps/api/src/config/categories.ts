export const SCENE_CATEGORIES = ["movies", "memes", "politics"] as const;
export type SceneCategory = typeof SCENE_CATEGORIES[number];

export const CATEGORY_LABELS: Record<SceneCategory, string> = {
  movies: "🎬 Кино/сериалы",
  memes: "😂 Мемы",
  politics: "🏛️ Политика",
};


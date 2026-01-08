"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import type { Category, GameMode } from "@dubdub/shared";

type Step = "category" | "mode" | "players";

const CATEGORIES: { id: Category; label: string; emoji: string }[] = [
  { id: "movies", label: "Кино/сериалы", emoji: "🎬" },
  { id: "memes", label: "Мемы", emoji: "😂" },
  { id: "politics", label: "Политика", emoji: "🏛️" },
];

const MODES: { id: GameMode; label: string; emoji: string; desc: string }[] = [
  { id: "improv", label: "Импровизация", emoji: "🎭", desc: "Свобода творчества" },
  { id: "tasks", label: "С заданиями", emoji: "📝", desc: "Выполни задание" },
];

export default function CreatePage() {
  const router = useRouter();
  const { isReady, initData } = useTelegram();
  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<Category | null>(null);
  const [gameMode, setGameMode] = useState<GameMode | null>(null);
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!initData || !category || !gameMode) {
      setError("Выбери все параметры");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await api.createSession(initData, { 
        maxPlayers: maxPlayers as 1 | 2, 
        category, 
        gameMode 
      });
      router.push(`/s/${result.sessionId}`);
    } catch (err) {
      console.error("Create failed:", err);
      setError(err instanceof Error ? err.message : "Ошибка создания");
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step === "mode") setStep("category");
    if (step === "players") setStep("mode");
  };

  const handleCategorySelect = (cat: Category) => {
    setCategory(cat);
    setStep("mode");
  };

  const handleModeSelect = (mode: GameMode) => {
    setGameMode(mode);
    setStep("players");
  };

  if (!isReady) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-accent-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-6">
      <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full space-y-8">
        
        {/* Back button */}
        {step !== "category" && (
          <button 
            onClick={handleBack}
            className="absolute top-4 left-4 text-tg-hint hover:text-white transition-colors"
          >
            ← Назад
          </button>
        )}

        {/* Step 1: Category */}
        {step === "category" && (
          <>
            <div className="text-center animate-slide-up">
              <h1 className="text-3xl font-bold mb-2">Выбери категорию</h1>
              <p className="text-tg-hint">Что будем озвучивать?</p>
            </div>

            <div className="space-y-3 animate-fade-in" style={{ animationDelay: "0.1s" }}>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleCategorySelect(cat.id)}
                  className="w-full card hover:bg-white/10 transition-colors flex items-center gap-4 py-5"
                >
                  <span className="text-4xl">{cat.emoji}</span>
                  <span className="text-xl font-medium">{cat.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 2: Mode */}
        {step === "mode" && (
          <>
            <div className="text-center animate-slide-up">
              <h1 className="text-3xl font-bold mb-2">Выбери режим</h1>
              <p className="text-tg-hint">Как будем играть?</p>
            </div>

            <div className="space-y-3 animate-fade-in" style={{ animationDelay: "0.1s" }}>
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => handleModeSelect(mode.id)}
                  className="w-full card hover:bg-white/10 transition-colors flex items-center gap-4 py-5"
                >
                  <span className="text-4xl">{mode.emoji}</span>
                  <div className="text-left">
                    <div className="text-xl font-medium">{mode.label}</div>
                    <div className="text-sm text-tg-hint">{mode.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 3: Players */}
        {step === "players" && (
          <>
            <div className="text-center animate-slide-up">
              <h1 className="text-3xl font-bold mb-2">Сколько игроков?</h1>
              <p className="text-tg-hint">
                {CATEGORIES.find(c => c.id === category)?.emoji}{" "}
                {CATEGORIES.find(c => c.id === category)?.label} •{" "}
                {MODES.find(m => m.id === gameMode)?.label}
              </p>
            </div>

            <div className="card animate-fade-in" style={{ animationDelay: "0.1s" }}>
              <div className="grid grid-cols-2 gap-3">
                {[1, 2].map((n) => (
                  <button
                    key={n}
                    onClick={() => setMaxPlayers(n)}
                    className={`py-6 rounded-xl border-2 transition-all font-bold text-3xl ${
                      maxPlayers === n
                        ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                        : "border-white/10 text-tg-hint hover:border-white/20"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-tg-hint text-sm mt-4 text-center">
                {maxPlayers === 1
                  ? "🎭 Соло: озвучь все реплики сам"
                  : "👥 Дуэт: вдвоём веселее!"}
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm text-center">
                {error}
              </div>
            )}

            {/* Create Button */}
            <button
              onClick={handleCreate}
              disabled={loading}
              className="btn-primary text-lg py-4 w-full animate-fade-in"
              style={{ animationDelay: "0.2s" }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Создание...
                </span>
              ) : (
                "Создать игру →"
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

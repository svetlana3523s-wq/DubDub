"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RU } from "@dubdub/shared";
import type { Category, GameMode } from "@dubdub/shared";

type Step = "category" | "mode" | "players";

const CATEGORIES: { id: Category; label: string; emoji: string }[] = [
  { id: "movies", label: RU.web.create.categories.movies, emoji: "🎬" },
  { id: "memes", label: RU.web.create.categories.memes, emoji: "😂" },
  { id: "politics", label: RU.web.create.categories.politics, emoji: "🏛" },
];

const MODES: { id: GameMode; label: string; emoji: string; desc: string }[] = [
  {
    id: "improv",
    label: RU.web.create.modes.improv,
    emoji: "🎭",
    desc: RU.web.create.modes.improvDesc,
  },
  {
    id: "tasks",
    label: RU.web.create.modes.tasks,
    emoji: "📝",
    desc: RU.web.create.modes.tasksDesc,
  },
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
      setError(RU.web.create.createErrorMissing);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await api.createSession(initData, {
        maxPlayers: maxPlayers as 1 | 2,
        category,
        gameMode,
      });
      router.push(`/s/${result.sessionId}`);
    } catch (err) {
      console.error("Create failed:", err);
      setError(err instanceof Error ? err.message : RU.web.create.createErrorGeneric);
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
          <Button
            onClick={handleBack}
            variant="ghost"
            size="sm"
            className="absolute top-4 left-4"
          >
            {RU.web.create.back}
          </Button>
        )}

        {/* Step 1: Category */}
        {step === "category" && (
          <>
            <div className="text-center animate-slide-up">
              <h1 className="text-3xl font-bold mb-2">{RU.web.create.chooseCategoryTitle}</h1>
              <p className="text-tg-hint">{RU.web.create.chooseCategorySubtitle}</p>
            </div>

            <div className="space-y-3 animate-fade-in" style={{ animationDelay: "0.1s" }}>
              {CATEGORIES.map((cat) => (
                <Button
                  key={cat.id}
                  onClick={() => handleCategorySelect(cat.id)}
                  variant="secondary"
                  className="w-full justify-start gap-4 py-5 text-left"
                >
                  <span className="text-4xl">{cat.emoji}</span>
                  <span className="text-xl font-medium">{cat.label}</span>
                </Button>
              ))}
            </div>
          </>
        )}

        {/* Step 2: Mode */}
        {step === "mode" && (
          <>
            <div className="text-center animate-slide-up">
              <h1 className="text-3xl font-bold mb-2">{RU.web.create.chooseModeTitle}</h1>
              <p className="text-tg-hint">{RU.web.create.chooseModeSubtitle}</p>
            </div>

            <div className="space-y-3 animate-fade-in" style={{ animationDelay: "0.1s" }}>
              {MODES.map((mode) => (
                <Button
                  key={mode.id}
                  onClick={() => handleModeSelect(mode.id)}
                  variant="secondary"
                  className="w-full justify-start gap-4 py-5 text-left"
                >
                  <span className="text-4xl">{mode.emoji}</span>
                  <div className="text-left">
                    <div className="text-xl font-medium">{mode.label}</div>
                    <div className="text-sm text-tg-hint">{mode.desc}</div>
                  </div>
                </Button>
              ))}
            </div>
          </>
        )}

        {/* Step 3: Players */}
        {step === "players" && (
          <>
            <div className="text-center animate-slide-up">
              <h1 className="text-3xl font-bold mb-2">{RU.web.create.choosePlayersTitle}</h1>
              <p className="text-tg-hint">
                {RU.web.create.playersSubtitle(
                  CATEGORIES.find((c) => c.id === category)?.label || "",
                  MODES.find((m) => m.id === gameMode)?.label || ""
                )}
              </p>
            </div>

            <Card className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
              <div className="grid grid-cols-2 gap-3">
                {[1, 2].map((n) => (
                  <Button
                    key={n}
                    onClick={() => setMaxPlayers(n)}
                    variant="secondary"
                    className={`py-6 text-3xl font-bold ${
                      maxPlayers === n
                        ? "border-accent-primary bg-accent-primary/20 text-white ring-2 ring-accent-primary/70 shadow-glow"
                        : "border-white/10 text-tg-hint hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              <p className="text-tg-hint text-sm mt-4 text-center">
                {maxPlayers === 1 ? RU.web.create.soloHint : RU.web.create.duoHint}
              </p>
            </Card>

            {/* Error */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm text-center">
                {error}
              </div>
            )}

            {/* Create Button */}
            <Button
              onClick={handleCreate}
              disabled={loading}
              className="text-lg py-4 w-full animate-fade-in"
              style={{ animationDelay: "0.2s" }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {RU.web.create.creating}
                </span>
              ) : (
                RU.web.create.createButton
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

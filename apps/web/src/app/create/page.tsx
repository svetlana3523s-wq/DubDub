"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";

export default function CreatePage() {
  const router = useRouter();
  const { isReady, initData } = useTelegram();
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!initData) {
      setError("Telegram WebApp не инициализирован");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await api.createSession(initData, { maxPlayers });
      router.push(`/s/${result.sessionId}`);
    } catch (err) {
      console.error("Create failed:", err);
      setError(err instanceof Error ? err.message : "Ошибка создания");
    } finally {
      setLoading(false);
    }
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
        {/* Header */}
        <div className="text-center animate-slide-up">
          <h1 className="text-3xl font-bold mb-2">Новый дубляж</h1>
          <p className="text-tg-hint">Выбери количество игроков</p>
        </div>

        {/* Players Selection */}
        <div className="card animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <h2 className="text-lg font-medium mb-4">Игроков</h2>
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                onClick={() => setMaxPlayers(n)}
                className={`py-5 rounded-xl border-2 transition-all font-bold text-2xl ${
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
              ? "Соло: озвучь все реплики сам"
              : maxPlayers === 2
              ? "Дуэт: классика для двоих"
              : "Трио: максимум хаоса!"}
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
      </div>
    </div>
  );
}


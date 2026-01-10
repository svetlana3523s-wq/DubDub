"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import type { SceneListItem, Category } from "@dubdub/shared";

const CATEGORIES: { id: Category | ""; label: string }[] = [
  { id: "", label: "Все" },
  { id: "movies", label: "🎬 Кино/сериалы" },
  { id: "memes", label: "😂 Мемы" },
  { id: "politics", label: "🏛️ Политика" },
];

export default function AdminScenesPage() {
  const router = useRouter();
  const { isReady, initData } = useTelegram();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [scenes, setScenes] = useState<SceneListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [category, setCategory] = useState<Category | "">("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check admin access
  useEffect(() => {
    if (!isReady) {
      // Wait for Telegram to be ready
      return;
    }

    if (!initData) {
      // Not opened in Telegram Mini App
      setError("Админка доступна только через Telegram Mini App. Откройте бота и нажмите кнопку для открытия приложения.");
      setIsAdmin(false);
      return;
    }

    const checkAdmin = async () => {
      try {
        const result = await api.checkAdmin(initData);
        if (!result.isAdmin) {
          setError("У вас нет прав администратора");
          setIsAdmin(false);
          return;
        }
        setIsAdmin(true);
      } catch (err) {
        console.error("Failed to check admin:", err);
        setError("Ошибка проверки прав администратора");
        setIsAdmin(false);
      }
    };

    checkAdmin();
  }, [isReady, initData, router]);

  // Load scenes
  const loadScenes = useCallback(async () => {
    if (!initData || !isAdmin) return;

    setLoading(true);
    setError(null);

    try {
      const result = await api.getScenes(initData, {
        page,
        limit,
        category: category || undefined,
        search: search || undefined,
      });
      setScenes(result.scenes);
      setTotal(result.total);
    } catch (err: any) {
      console.error("Failed to load scenes:", err);
      setError(err.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [initData, isAdmin, page, limit, category, search]);

  useEffect(() => {
    loadScenes();
  }, [loadScenes]);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const handleDelete = async (sceneId: string, force: boolean = false) => {
    if (!initData) return;
    
    const confirmMsg = force 
      ? "⚠️ Принудительное удаление! Все связанные сессии тоже будут удалены. Продолжить?"
      : "Удалить эту сцену? Это действие нельзя отменить.";
    
    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      await api.deleteScene(initData, sceneId, force);
      loadScenes();
    } catch (err: any) {
      const msg = err.message || "Ошибка удаления";
      // If error mentions active sessions, offer force delete
      if (msg.includes("active session") && !force) {
        if (confirm(`${msg}\n\nУдалить принудительно?`)) {
          handleDelete(sceneId, true);
        }
      } else {
        alert(msg);
      }
    }
  };

  if (!isReady || isAdmin === null) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-accent-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-2xl font-bold mb-4">Нет доступа</h2>
        {error ? (
          <p className="text-tg-hint mb-6">{error}</p>
        ) : (
          <p className="text-tg-hint mb-6">
            Админка доступна только через Telegram Mini App.<br />
            Откройте бота и используйте кнопку для входа в приложение.
          </p>
        )}
        <button
          onClick={() => router.push("/")}
          className="btn-primary"
        >
          На главную
        </button>
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="flex-1 flex flex-col p-6 pb-8">
      <div className="max-w-4xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-1">Управление сценами</h1>
            <p className="text-tg-hint text-sm">Всего сцен: {total}</p>
          </div>
          <button
            onClick={() => router.push("/admin/upload")}
            className="btn-tg"
          >
            ➕ Новая сцена
          </button>
        </div>

        {/* Filters */}
        <div className="card space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Поиск по названию</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Введите название..."
                className="flex-1 px-4 py-2 rounded-lg bg-tg-secondary text-white placeholder-tg-hint focus:outline-none focus:ring-2 focus:ring-accent-primary"
              />
              <button onClick={handleSearch} className="btn-tg">
                🔍 Найти
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Категория</label>
            <div className="grid grid-cols-4 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setCategory(cat.id);
                    setPage(1);
                  }}
                  className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                    category === cat.id
                      ? "bg-accent-primary text-white"
                      : "bg-tg-secondary text-tg-hint hover:bg-tg-secondary/80"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="card bg-red-500/20 border-red-500/50">
            <div className="text-red-500 text-sm">{error}</div>
          </div>
        )}

        {/* Scenes List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-10 h-10 border-3 border-accent-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : scenes.length === 0 ? (
          <div className="card text-center py-12">
            <div className="text-tg-hint">Сцен не найдено</div>
            <button
              onClick={() => router.push("/admin/upload")}
              className="mt-4 btn-tg"
            >
              ➕ Загрузить первую сцену
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {scenes.map((scene) => (
              <div key={scene.id} className="card">
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-medium">{scene.title}</h3>
                      <span className="text-xs text-tg-hint bg-tg-secondary px-2 py-0.5 rounded">
                        {CATEGORIES.find((c) => c.id === scene.category)?.label || scene.category}
                      </span>
                    </div>
                    <div className="text-sm text-tg-hint space-y-1">
                      <div>⏱ Длительность: {scene.durationSec.toFixed(1)}s</div>
                      <div>🎭 Ролей: {scene.rolesCount}</div>
                      <div>📅 {new Date(scene.createdAt).toLocaleDateString("ru-RU")}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push(`/admin/scenes/${scene.id}/edit`)}
                      className="px-4 py-2 rounded-lg bg-accent-primary/20 text-accent-primary text-sm hover:bg-accent-primary/30 transition-colors"
                    >
                      ✏️ Редактировать
                    </button>
                    <button
                      onClick={() => handleDelete(scene.id)}
                      className="px-4 py-2 rounded-lg bg-red-500/20 text-red-500 text-sm hover:bg-red-500/30 transition-colors"
                    >
                      🗑 Удалить
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 rounded-lg bg-tg-secondary text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ← Назад
                </button>
                <div className="text-sm text-tg-hint">
                  Страница {page} из {totalPages}
                </div>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 rounded-lg bg-tg-secondary text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Вперед →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


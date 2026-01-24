"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RU } from "@dubdub/shared";
import type { SceneListItem, Category } from "@dubdub/shared";

const CATEGORIES: { id: Category | ""; label: string }[] = [
  { id: "", label: RU.web.admin.scenes.categoryAll },
  { id: "movies", label: RU.web.admin.scenes.categoryMovies },
  { id: "memes", label: RU.web.admin.scenes.categoryMemes },
  { id: "politics", label: RU.web.admin.scenes.categoryPolitics },
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
      setError(RU.web.admin.scenes.noAccessBody);
      setIsAdmin(false);
      return;
    }

    const checkAdmin = async () => {
      try {
        const result = await api.checkAdmin(initData);
        if (!result.isAdmin) {
          setError(RU.web.admin.scenes.noAccessShort);
          setIsAdmin(false);
          return;
        }
        setIsAdmin(true);
      } catch (err) {
        console.error("Failed to check admin:", err);
        setError(RU.web.admin.scenes.adminCheckError);
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
      setError(err.message || RU.web.admin.scenes.loadError);
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
      ? RU.web.admin.scenes.deleteForceConfirm
      : RU.web.admin.scenes.deleteConfirm;

    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      await api.deleteScene(initData, sceneId, force);
      loadScenes();
    } catch (err: any) {
      const msg = err.message || RU.web.admin.scenes.deleteError;
      // If error mentions active sessions, offer force delete
      if (msg.includes("active session") && !force) {
        if (confirm(`${msg}\n\n${RU.web.admin.scenes.deleteForcePrompt}`)) {
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
        <h2 className="text-2xl font-bold mb-4">{RU.web.admin.scenes.noAccessTitle}</h2>
        {error ? (
          <p className="text-tg-hint mb-6">{error}</p>
        ) : (
          <p className="text-tg-hint mb-6">{RU.web.admin.scenes.noAccessBody}</p>
        )}
        <Button variant="primary" onClick={() => router.push("/")}>            {RU.web.session.backHome}
        </Button>
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="flex-1 flex flex-col p-6 pb-8">
      <div className="max-w-4xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-1">{RU.web.admin.scenes.title}</h1>
            <p className="text-tg-hint text-sm">{RU.web.admin.scenes.totalLabel(total)}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => router.push("/admin/tasks")}>
              {RU.web.admin.tasks.title}
            </Button>
            <Button variant="primary" onClick={() => router.push("/admin/upload")}>
              {RU.web.admin.scenes.newScene}
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">{RU.web.admin.scenes.searchLabel}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder={RU.web.admin.scenes.searchPlaceholder}
                className="flex-1 px-4 py-2 rounded-lg bg-tg-secondary text-white placeholder-tg-hint focus:outline-none focus:ring-2 focus:ring-accent-primary"
              />
              <Button variant="secondary" onClick={handleSearch}>
                {RU.web.admin.scenes.searchButton}
              </Button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">{RU.web.admin.scenes.categoryLabel}</label>
            <div className="grid grid-cols-4 gap-2">
              {CATEGORIES.map((cat) => (
                <Button
                  key={cat.id}
                  variant="secondary"
                  onClick={() => {
                    setCategory(cat.id);
                    setPage(1);
                  }}
                  className={`px-4 py-2 text-sm transition-colors ${
                    category === cat.id
                      ? "bg-accent-primary text-white"
                      : "bg-tg-secondary text-tg-hint hover:bg-tg-secondary/80"
                  }`}
                >
                  {cat.label}
                </Button>
              ))}
            </div>
          </div>
        </Card>

        {error && (
          <Card className="bg-red-500/20 border-red-500/50">
            <div className="text-red-500 text-sm">{error}</div>
          </Card>
        )}

        {/* Scenes List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-10 h-10 border-3 border-accent-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : scenes.length === 0 ? (
          <Card className="text-center py-12">
            <div className="text-tg-hint">{RU.web.admin.scenes.emptyTitle}</div>
            <Button variant="primary" onClick={() => router.push("/admin/upload")} className="mt-4">
              {RU.web.admin.scenes.emptyButton}
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {scenes.map((scene) => (
              <Card key={scene.id}>
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-medium">{scene.title}</h3>
                      <span className="text-xs text-tg-hint bg-tg-secondary px-2 py-0.5 rounded">
                        {CATEGORIES.find((c) => c.id === scene.category)?.label || scene.category}
                      </span>
                    </div>
                    <div className="text-sm text-tg-hint space-y-1">
                      <div>{RU.web.admin.scenes.durationLabel(scene.durationSec.toFixed(1))}</div>
                      <div>{RU.web.admin.scenes.rolesLabel(scene.rolesCount)}</div>
                      <div>📅 {new Date(scene.createdAt).toLocaleDateString("ru-RU")}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => router.push(`/admin/scenes/${scene.id}/edit`)}
                      className="px-4 py-2"
                    >
                      {RU.web.admin.scenes.editButton}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(scene.id)}
                      className="px-4 py-2"
                    >
                      {RU.web.admin.scenes.deleteButton}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2"
                >
                  {RU.web.admin.scenes.prevPage}
                </Button>
                <div className="text-sm text-tg-hint">
                  Страница {page} из {totalPages}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2"
                >
                  {RU.web.admin.scenes.nextPage}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

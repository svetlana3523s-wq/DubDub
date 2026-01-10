"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import { CueEditor } from "@/components/CueEditor";
import type { SceneDetail, Category, Cue } from "@dubdub/shared";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "movies", label: "🎬 Кино/сериалы" },
  { id: "memes", label: "😂 Мемы" },
  { id: "politics", label: "🏛️ Политика" },
];

export default function AdminSceneEditPage() {
  const router = useRouter();
  const params = useParams();
  const sceneId = params.id as string;
  const { isReady, initData } = useTelegram();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scene data
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("memes");
  const [cues, setCues] = useState<Cue[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check admin access and load scene
  useEffect(() => {
    if (!isReady || !initData) return;

    const load = async () => {
      try {
        // Check admin
        const adminCheck = await api.checkAdmin(initData);
        if (!adminCheck.isAdmin) {
          router.push("/");
          return;
        }
        setIsAdmin(true);

        // Load scene
        const sceneData = await api.getScene(initData, sceneId);
        setScene(sceneData);
        setTitle(sceneData.title);
        setCategory(sceneData.category);
        setCues(sceneData.cues);
        setVideoUrl(sceneData.videoUrl);
      } catch (err: any) {
        console.error("Failed to load:", err);
        setError(err.message || "Ошибка загрузки");
        router.push("/admin/scenes");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [isReady, initData, sceneId, router]);

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setError("Выберите видео файл");
      return;
    }

    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
  };

  const handleSave = async () => {
    if (!initData || !scene || !title.trim()) {
      setError("Заполните все поля");
      return;
    }

    if (cues.length === 0) {
      setError("Добавьте хотя бы один тайминг");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const formData = new FormData();
      if (videoFile) {
        formData.append("video", videoFile);
      }
      formData.append("title", title.trim());
      formData.append("category", category);
      formData.append("cues", JSON.stringify(cues));

      await api.updateScene(initData, sceneId, formData);
      router.push("/admin/scenes");
    } catch (err: any) {
      console.error("Save failed:", err);
      setError(err.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (force: boolean = false) => {
    if (!initData) return;
    
    const confirmMsg = force 
      ? "⚠️ Принудительное удаление! Все связанные сессии тоже будут удалены. Продолжить?"
      : "Удалить эту сцену? Это действие нельзя отменить.";
    
    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      await api.deleteScene(initData, sceneId, force);
      router.push("/admin/scenes");
    } catch (err: any) {
      const msg = err.message || "Ошибка удаления";
      // If error mentions active sessions, offer force delete
      if (msg.includes("active session") && !force) {
        if (confirm(`${msg}\n\nУдалить принудительно?`)) {
          handleDelete(true);
        }
      } else {
        alert(msg);
      }
    }
  };

  if (!isReady || isAdmin === null || loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-accent-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin || !scene) {
    return null; // Will redirect
  }

  return (
    <div className="flex-1 flex flex-col p-6 pb-8">
      <div className="max-w-2xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-1">Редактирование сцены</h1>
            <p className="text-tg-hint text-sm">ID: {sceneId}</p>
          </div>
          <button
            onClick={() => router.push("/admin/scenes")}
            className="text-tg-hint hover:text-white transition-colors"
          >
            ← Назад к списку
          </button>
        </div>

        {error && (
          <div className="card bg-red-500/20 border-red-500/50">
            <div className="text-red-500 text-sm">{error}</div>
          </div>
        )}

        {/* Details */}
        <div className="card space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Название сцены</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Классика мемов"
              className="w-full px-4 py-2 rounded-lg bg-tg-secondary text-white placeholder-tg-hint focus:outline-none focus:ring-2 focus:ring-accent-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Категория</label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id)}
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
          <div>
            <label className="block text-sm font-medium mb-2">Видео</label>
            {videoFile ? (
              <div className="space-y-2">
                <div className="text-sm text-tg-hint">
                  Новое видео: {videoFile.name} ({(videoFile.size / (1024 * 1024)).toFixed(2)} MB)
                </div>
                <button
                  onClick={() => {
                    setVideoFile(null);
                    setVideoUrl(scene.videoUrl);
                  }}
                  className="text-sm text-red-500 hover:text-red-400"
                >
                  Отменить замену
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-sm text-tg-hint">
                  Текущее видео: {scene.videoUrl.split("/").pop()}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-tg text-sm"
                >
                  🔄 Заменить видео
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Cue Editor */}
        <CueEditor
          videoUrl={videoUrl}
          videoDuration={scene.durationSec}
          fps={scene.fps}
          cues={cues}
          onChange={setCues}
        />

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/admin/scenes")}
            className="flex-1 btn-tg"
          >
            Отмена
          </button>
          <button
            onClick={() => handleDelete()}
            className="px-4 py-2 rounded-lg bg-red-500/20 text-red-500 hover:bg-red-500/30 transition-colors"
          >
            🗑 Удалить
          </button>
          <button
            onClick={handleSave}
            disabled={saving || cues.length === 0}
            className="flex-1 btn-tg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Сохранение..." : "💾 Сохранить изменения"}
          </button>
        </div>
      </div>
    </div>
  );
}


"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import { CueEditor } from "@/components/CueEditor";
import type { Category, Cue } from "@dubdub/shared";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "movies", label: "🎬 Кино/сериалы" },
  { id: "memes", label: "😂 Мемы" },
  { id: "politics", label: "🏛️ Политика" },
];

type Step = "upload" | "details" | "cues";

export default function AdminUploadPage() {
  const router = useRouter();
  const { isReady, initData } = useTelegram();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [fps, setFps] = useState(30);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("memes");
  const [cues, setCues] = useState<Cue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check admin access
  useEffect(() => {
    if (!isReady || !initData) return;

    const checkAdmin = async () => {
      try {
        const result = await api.checkAdmin(initData);
        if (!result.isAdmin) {
          router.push("/");
          return;
        }
        setIsAdmin(true);
      } catch (err) {
        console.error("Failed to check admin:", err);
        router.push("/");
      }
    };

    checkAdmin();
  }, [isReady, initData, router]);

  // Handle video file selection
  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setError("Выберите видео файл");
      return;
    }

    // Check file size (500 MB limit)
    const maxSize = 500 * 1024 * 1024; // 500 MB
    if (file.size > maxSize) {
      setError(`Файл слишком большой (${(file.size / 1024 / 1024).toFixed(2)} MB). Максимум: ${(maxSize / 1024 / 1024).toFixed(0)} MB`);
      return;
    }

    console.log("[Upload] File selected:", { name: file.name, size: file.size, type: file.type });

    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);

    // Get video metadata
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;
    video.onloadedmetadata = () => {
      setVideoDuration(video.duration);
      // Default FPS (will be corrected by backend)
      setFps(30);
      setStep("details");
    };
    video.onerror = () => {
      setError("Не удалось загрузить видео");
      setVideoFile(null);
      setVideoUrl(null);
    };
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleNext = () => {
    if (step === "upload") {
      if (!videoFile) {
        setError("Загрузите видео");
        return;
      }
      setStep("details");
    } else if (step === "details") {
      if (!title.trim()) {
        setError("Введите название");
        return;
      }
      setStep("cues");
    }
  };

  const handleSubmit = async () => {
    if (!initData || !videoFile || !title.trim() || cues.length === 0) {
      setError("Заполните все поля и добавьте хотя бы один тайминг");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log("[Upload] Starting upload...", {
        videoFile: { name: videoFile.name, size: videoFile.size, type: videoFile.type },
        title,
        category,
        cuesCount: cues.length,
      });

      const formData = new FormData();
      formData.append("video", videoFile);
      formData.append("title", title.trim());
      formData.append("category", category);
      formData.append("cues", JSON.stringify(cues));

      console.log("[Upload] FormData created, calling api.uploadScene...");

      const result = await api.uploadScene(initData, formData);
      
      console.log("[Upload] Upload successful:", result);
      router.push(`/admin/scenes/${result.sceneId}/edit`);
    } catch (err: any) {
      console.error("[Upload] Upload failed:", err);
      setError(err.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
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
    return null; // Will redirect
  }

  return (
    <div className="flex-1 flex flex-col p-6 pb-8">
      <div className="max-w-2xl mx-auto w-full space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-1">Загрузка новой сцены</h1>
          <p className="text-tg-hint text-sm">Создайте новую сцену для озвучки</p>
        </div>

        {error && (
          <div className="card bg-red-500/20 border-red-500/50">
            <div className="text-red-500 text-sm">{error}</div>
          </div>
        )}

        {/* Step 1: Upload Video */}
        {step === "upload" && (
          <div className="card">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="border-2 border-dashed border-tg-hint rounded-xl p-8 text-center cursor-pointer hover:border-accent-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
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
              <div className="text-4xl mb-4">📹</div>
              <div className="text-lg font-medium mb-2">Загрузите видео</div>
              <div className="text-tg-hint text-sm">
                Перетащите файл сюда или нажмите для выбора
              </div>
              {videoFile && (
                <div className="mt-4 text-sm text-accent-primary">
                  Выбрано: {videoFile.name} ({(videoFile.size / (1024 * 1024)).toFixed(2)} MB)
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Details */}
        {step === "details" && (
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
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setStep("upload");
                  setError(null);
                }}
                className="flex-1 btn-tg"
              >
                ← Назад
              </button>
              <button onClick={handleNext} className="flex-1 btn-tg">
                Далее →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Cues */}
        {step === "cues" && (
          <div className="space-y-4">
            <CueEditor
              videoUrl={videoUrl}
              videoDuration={videoDuration}
              fps={fps}
              cues={cues}
              onChange={setCues}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setStep("details");
                  setError(null);
                }}
                className="flex-1 btn-tg"
              >
                ← Назад
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || cues.length === 0}
                className="flex-1 btn-tg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Загрузка..." : "✅ Загрузить сцену"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


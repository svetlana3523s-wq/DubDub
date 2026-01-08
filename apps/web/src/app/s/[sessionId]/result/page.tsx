"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import type { RenderStatusResponse, SessionStateResponse } from "@dubdub/shared";

interface PageProps {
  params: { sessionId: string };
}

export default function ResultPage({ params }: PageProps) {
  const { sessionId } = params;
  const { isReady, initData } = useTelegram();
  const [render, setRender] = useState<RenderStatusResponse | null>(null);
  const [session, setSession] = useState<SessionStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!isReady || !initData) return;

    const fetchData = async () => {
      try {
        const [renderData, sessionData] = await Promise.all([
          api.getRenderStatus(initData, sessionId),
          api.getSession(initData, sessionId),
        ]);
        setRender(renderData);
        setSession(sessionData);
      } catch (err) {
        console.error("Fetch failed:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Poll while not ready
    const interval = setInterval(async () => {
      try {
        const data = await api.getRenderStatus(initData, sessionId);
        setRender(data);
        if (data.status === "ready" || data.status === "failed") {
          clearInterval(interval);
        }
      } catch {
        // ignore
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isReady, initData, sessionId]);

  const handleShare = () => {
    const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME || "DubDubBot";
    const link = `https://t.me/${botUsername}?startapp=${sessionId}`;
    navigator.clipboard.writeText(link);
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");

    // Try to share via Telegram
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Смотри наш дубляж! 🎬")}`
      );
    }
  };

  const handleSendToTelegram = async () => {
    if (!initData || sending || sent) return;
    
    setSending(true);
    try {
      await api.sendVideoToTelegram(initData, sessionId);
      setSent(true);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      
      // Close mini app after short delay to show the video in chat
      setTimeout(() => {
        window.Telegram?.WebApp?.close();
      }, 1500);
    } catch (err) {
      console.error("Send failed:", err);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
    } finally {
      setSending(false);
    }
  };

  if (loading || !isReady) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-12 h-12 border-3 border-accent-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!render || render.status === "failed") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="text-5xl">😢</div>
          <h2 className="text-xl font-bold">Не удалось создать видео</h2>
          <p className="text-tg-hint">Попробуйте ещё раз</p>
          <Link href="/" className="btn-primary inline-block">
            На главную
          </Link>
        </div>
      </div>
    );
  }

  if (render.status !== "ready" || !render.videoUrl) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-6 animate-slide-up">
          <div className="relative w-20 h-20 mx-auto">
            <div className="w-full h-full border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-2xl">
              🎥
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold mb-2">Рендерим видео</h2>
            <p className="text-tg-hint">Почти готово...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-6">
      <div className="flex-1 flex flex-col justify-center max-w-lg mx-auto w-full space-y-6">
        {/* Header */}
        <div className="text-center animate-slide-up">
          <div className="text-4xl mb-3">🎉</div>
          <h1 className="text-2xl font-bold mb-1">Готово!</h1>
          <p className="text-tg-hint">Ваш дубляж собран</p>
        </div>

        {/* Task (only in tasks mode) */}
        {session && session.session.gameMode === "tasks" && session.session.task && (
          <div className="card text-center animate-fade-in">
            <div className="text-sm text-tg-hint mb-1">📝 Задание</div>
            <div className="font-medium">{session.session.task}</div>
          </div>
        )}

        {/* Video */}
        <div className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <video
            src={render.videoUrl}
            controls
            autoPlay
            playsInline
            className="w-full rounded-2xl shadow-2xl"
          />
        </div>

        {/* Players */}
        {session && (
          <div className="flex justify-center gap-2 flex-wrap animate-fade-in" style={{ animationDelay: "0.15s" }}>
            {session.participants.map((p) => (
              <span
                key={p.id}
                className="px-3 py-1.5 bg-tg-secondary rounded-full text-sm"
              >
                {p.displayName}
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3 animate-fade-in" style={{ animationDelay: "0.2s" }}>
          {/* Send to Telegram - prominent */}
          <button
            onClick={handleSendToTelegram}
            disabled={sending || sent}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {sent ? (
              <>✅ Отправлено в чат!</>
            ) : sending ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Отправляем...
              </>
            ) : (
              <>📥 Сохранить в Telegram</>
            )}
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={handleShare} className="btn-tg">
              📤 Поделиться
            </button>
            <Link href="/create" className="btn-primary text-center">
              🎬 Ещё раз
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}


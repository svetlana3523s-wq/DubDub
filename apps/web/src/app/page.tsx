"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { getStartParam } from "@/lib/telegram";
import { api } from "@/lib/api";

export default function HomePage() {
  const { isReady, initData, user } = useTelegram();
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Handle deep link startapp parameters
  useEffect(() => {
    if (!isReady) return;

    const startParam = getStartParam();
    if (!startParam) return;

    console.log("[Home] start_param detected:", startParam);

    // Handle s_sessionId format (direct session link from ?startapp=s_sessionId)
    if (startParam.startsWith("s_")) {
      const sessionId = startParam.slice(2); // Remove "s_" prefix
      console.log("[Home] Direct session link, redirecting to:", sessionId);
      router.push(`/s/${sessionId}`);
      return;
    }

    // Handle join_CODE format (from ?startapp=join_CODE)
    if (startParam.startsWith("join_")) {
      const code = startParam.slice(5).toUpperCase(); // Remove "join_" prefix
      if (code) {
        // Need initData to join - if not available, wait for it
        if (!initData) {
          console.log("[Home] join_ detected but no initData yet, waiting...");
          return; // Effect will re-run when initData becomes available
        }
        handleJoinByCode(code);
      }
      return;
    }
    
    // Other format - treat as direct session ID (for viewing results)
    console.log("[Home] Other start_param, treating as session ID:", startParam);
    router.push(`/s/${startParam}`);
  }, [isReady, initData]);

  const handleJoinByCode = async (code: string) => {
    if (!initData || joining) return;
    
    setJoining(true);
    setJoinError(null);
    
    try {
      // Find session by code (last 8 chars of session ID)
      const response = await api.joinByCode(initData, code);
      if (response.sessionId) {
        router.push(`/s/${response.sessionId}`);
      }
    } catch (err: any) {
      console.error("Join by code failed:", err);
      setJoinError(err.message || "Не удалось присоединиться");
      setJoining(false);
    }
  };

  if (!isReady) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-accent-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Show joining state
  if (joining) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-3 border-accent-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-tg-hint">Присоединяемся к игре...</p>
        </div>
      </div>
    );
  }

  // Show join error
  if (joinError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-sm">
          <div className="text-4xl">😕</div>
          <h2 className="text-xl font-bold">Не удалось присоединиться</h2>
          <p className="text-tg-hint">{joinError}</p>
          <Link href="/create" className="inline-flex items-center justify-center gap-2 font-medium transition active:scale-[0.98] bg-gradient-to-r from-fuchsia-500 via-purple-500 to-blue-500 text-white shadow-[0_12px_30px_-16px_rgba(99,102,241,0.8)] px-5 py-3 text-base rounded-3xl">
            🎬 Создать свою игру
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="text-center space-y-8 animate-slide-up max-w-sm">
        {/* Logo */}
        <div className="relative">
          <h1 className="text-5xl font-bold tracking-tight">
            <span className="text-accent-primary">Dub</span>
            <span className="text-white">Dub</span>
          </h1>
          <div className="absolute -inset-8 bg-accent-primary/20 blur-3xl rounded-full -z-10" />
        </div>

        {/* Greeting */}
        {user && (
          <p className="text-tg-hint">
            Привет, {user.firstName}! 👋
          </p>
        )}

        {/* Description */}
        <p className="text-lg text-tg-hint leading-relaxed">
        Озвучивай сцены один или с друзьями.
          <br />
       
        </p>

        {/* CTA */}
        <Link
          href="/create"
          className="inline-flex items-center justify-center gap-2 font-medium transition active:scale-[0.98] bg-gradient-to-r from-fuchsia-500 via-purple-500 to-blue-500 text-white shadow-[0_12px_30px_-16px_rgba(99,102,241,0.8)] px-6 py-4 text-lg rounded-3xl"
        >
          <span>🎬</span>
          <span>Создать дубляж</span>
        </Link>

        {/* How it works */}
        <div className="pt-4 space-y-3">
          <div className="flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center text-sm">1</div>
            <span className="text-tg-hint text-sm">Создай сессию и позови друзей</span>
          </div>
          <div className="flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center text-sm">2</div>
            <span className="text-tg-hint text-sm">Каждый записывает реплику</span>
          </div>
          <div className="flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center text-sm">3</div>
            <span className="text-tg-hint text-sm">Получи смешное видео!</span>
          </div>
        </div>
      </div>
    </div>
  );
}

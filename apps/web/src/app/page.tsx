"use client";

import Link from "next/link";
import { useTelegram } from "@/components/TelegramProvider";

export default function HomePage() {
  const { isReady, user } = useTelegram();

  if (!isReady) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-accent-primary border-t-transparent rounded-full animate-spin" />
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
          Озвучивай немое видео с друзьями.
          <br />
          Каждый слышит только часть!
        </p>

        {/* CTA */}
        <Link
          href="/create"
          className="btn-primary text-lg px-8 py-4 inline-flex items-center gap-2"
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


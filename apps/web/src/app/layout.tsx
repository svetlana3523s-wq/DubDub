import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { TelegramProvider } from "@/components/TelegramProvider";

export const metadata: Metadata = {
  title: "DubDub — Озвучь это!",
  description: "Озвучивай немое видео с друзьями в Telegram",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <head>
        {/* Telegram WebApp SDK must load before React hydration */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className="antialiased">
        <TelegramProvider>
          <main className="min-h-screen min-h-dvh flex flex-col safe-top safe-bottom">
            {children}
          </main>
        </TelegramProvider>
      </body>
    </html>
  );
}


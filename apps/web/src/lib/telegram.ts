// Telegram WebApp utilities

export function getTelegramWebApp() {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export function getStartParam(): string | null {
  const tg = getTelegramWebApp();
  return tg?.initDataUnsafe?.start_param ?? null;
}

export function closeMiniApp() {
  getTelegramWebApp()?.close();
}

export function hapticFeedback(type: "success" | "error" | "warning") {
  getTelegramWebApp()?.HapticFeedback?.notificationOccurred(type);
}

export function hapticImpact(style: "light" | "medium" | "heavy" = "medium") {
  getTelegramWebApp()?.HapticFeedback?.impactOccurred(style);
}


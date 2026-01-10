"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

interface TelegramUser {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
}

interface TelegramContextValue {
  user: TelegramUser | null;
  isReady: boolean;
  initData: string | null;
  retry: () => void; // Function to retry initialization
}

const TelegramContext = createContext<TelegramContextValue>({
  user: null,
  isReady: false,
  initData: null,
  retry: () => {},
});

export function useTelegram() {
  return useContext(TelegramContext);
}

// Extend Window type
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
          };
          start_param?: string;
        };
        themeParams: Record<string, string>;
        colorScheme: "light" | "dark";
        viewportHeight: number;
        viewportStableHeight: number;
        headerColor: string;
        backgroundColor: string;
        isExpanded: boolean;
        MainButton: {
          text: string;
          color: string;
          textColor: string;
          isVisible: boolean;
          isActive: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
          setText: (text: string) => void;
          enable: () => void;
          disable: () => void;
        };
        BackButton: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        HapticFeedback?: {
          impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
          notificationOccurred: (type: "error" | "success" | "warning") => void;
          selectionChanged: () => void;
        };
        openTelegramLink?: (url: string) => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
      };
    };
  }
}

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [initData, setInitData] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const doInit = () => {
    let attempts = 0;
    const maxAttempts = 30; // Try for up to 3 seconds (30 * 100ms)
    
    const tryInit = () => {
      const tg = window.Telegram?.WebApp;
      attempts++;

      console.log(`[TG] Attempt ${attempts}/${maxAttempts}, WebApp available: ${!!tg}, initData: ${tg?.initData ? 'yes' : 'no'}`);

      // If Telegram WebApp not available at all
      if (!tg) {
        if (attempts < maxAttempts) {
          setTimeout(tryInit, 100);
          return;
        }
        console.error("[TG] Telegram WebApp not available after all attempts");
        setIsReady(true);
        return;
      }

      // Initialize
      tg.ready();
      tg.expand();

      // Set theme colors
      try {
        tg.setHeaderColor("#0f0f0f");
        tg.setBackgroundColor("#0f0f0f");
      } catch {
        // Ignore if not supported
      }

      // Get init data - sometimes it takes a moment to be populated
      const data = tg.initData;
      if (!data) {
        if (attempts < maxAttempts) {
          setTimeout(tryInit, 100);
          return;
        }
        console.error("[TG] No initData available after all attempts");
        setIsReady(true);
        return;
      }

      console.log("[TG] Successfully got initData, length:", data.length);
      setInitData(data);

      // Get user
      const tgUser = tg.initDataUnsafe?.user;
      if (tgUser) {
        console.log("[TG] Got user:", tgUser.id, tgUser.first_name);
        setUser({
          id: String(tgUser.id),
          firstName: tgUser.first_name,
          lastName: tgUser.last_name,
          username: tgUser.username,
        });
      }

      setIsReady(true);
    };

    // Start initialization
    setTimeout(tryInit, 50);
  };

  // Retry function - resets state and tries again
  const retry = () => {
    console.log("[TG] Manual retry triggered");
    setIsReady(false);
    setInitData(null);
    setUser(null);
    setRetryCount(c => c + 1);
  };

  useEffect(() => {
    doInit();
  }, [retryCount]);

  return (
    <TelegramContext.Provider value={{ user, isReady, initData, retry }}>
      {children}
    </TelegramContext.Provider>
  );
}

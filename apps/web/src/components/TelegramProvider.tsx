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
    const maxAttempts = 50; // Try for up to 5 seconds (50 * 100ms)
    
    const tryInit = () => {
      attempts++;
      
      // Check if Telegram object exists at all
      const hasTelegram = typeof window !== 'undefined' && 'Telegram' in window;
      const tg = hasTelegram ? (window as any).Telegram?.WebApp : null;
      const hasInitData = tg?.initData && tg.initData.length > 0;

      console.log(`[TG] Attempt ${attempts}/${maxAttempts}: Telegram=${hasTelegram}, WebApp=${!!tg}, initData=${hasInitData}`);

      // If Telegram WebApp not available at all, keep trying
      if (!tg) {
        if (attempts < maxAttempts) {
          setTimeout(tryInit, 100);
          return;
        }
        console.error("[TG] Telegram WebApp not available after all attempts. URL:", window.location.href);
        setIsReady(true);
        return;
      }

      // Initialize
      try {
        tg.ready();
        tg.expand();
      } catch (e) {
        console.error("[TG] Error calling ready/expand:", e);
      }

      // Set theme colors
      try {
        tg.setHeaderColor("#0f0f0f");
        tg.setBackgroundColor("#0f0f0f");
      } catch {
        // Ignore if not supported
      }

      // Get init data - sometimes it takes a moment to be populated
      const data = tg.initData;
      if (!data || data.length === 0) {
        if (attempts < maxAttempts) {
          setTimeout(tryInit, 100);
          return;
        }
        console.error("[TG] No initData available after all attempts. initDataUnsafe:", JSON.stringify(tg.initDataUnsafe || {}));
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

    // Start initialization after a short delay to let scripts load
    setTimeout(tryInit, 100);
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

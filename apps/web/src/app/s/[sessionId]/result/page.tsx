"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import { VideoPlayer } from "@/components/VideoPlayer";
import type { RenderStatusResponse, SessionStateResponse } from "@dubdub/shared";

interface PageProps {
  params: { sessionId: string };
}

interface ReplayStatus {
  pending: boolean;
  mode?: string;
  requestedByName?: string;
  isRequester?: boolean;
  confirmed?: boolean;
}

export default function ResultPage({ params }: PageProps) {
  const { sessionId } = params;
  const router = useRouter();
  const { isReady, initData } = useTelegram();
  const [render, setRender] = useState<RenderStatusResponse | null>(null);
  const [session, setSession] = useState<SessionStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // Fixed timestamp for cache-busting (set once on mount)
  const [cacheTimestamp] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [replaying, setReplaying] = useState<"sameScene" | "newScene" | null>(null);
  const [showNewSceneConfirm, setShowNewSceneConfirm] = useState<"sameScene" | "newScene" | null>(null);
  
  // Multiplayer replay confirmation
  const [replayStatus, setReplayStatus] = useState<ReplayStatus>({ pending: false });
  const [waitingForConfirmation, setWaitingForConfirmation] = useState(false);
  const [confirmingReplay, setConfirmingReplay] = useState(false);

  // Check if this is a multiplayer session
  const isMultiplayer = session && session.session.maxPlayers > 1;

  // Track render error count for retry logic
  const [renderErrorCount, setRenderErrorCount] = useState(0);
  
  // Ref for send status polling
  const sendStatusPollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sendStatusPollAttemptRef = useRef<number>(0);
  const sendStatusPollStartTimeRef = useRef<number>(0);

  // Execute confirmed replay - only redirect if render is ready (users saw the result)
  const executeConfirmedReplay = useCallback(async () => {
    if (!initData) return;
    
    // Only execute replay if render is ready (users have seen the result)
    if (render?.status !== "ready") {
      console.log("[ExecuteReplay] Waiting for render to be ready before replay");
      return;
    }
    
    try {
      await api.executeReplay(initData, sessionId);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      setSent(false);
      setWaitingForConfirmation(false);
      // Use window.location for clean navigation
      window.location.href = `/s/${sessionId}`;
    } catch (err) {
      console.error("Execute replay failed:", err);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
      setWaitingForConfirmation(false);
    }
  }, [initData, sessionId, render]);

  // Fetch replay status and session status
  const fetchReplayStatus = useCallback(async () => {
    if (!initData) return;
    try {
      const status = await api.getReplayStatus(initData, sessionId);
      console.log("[ReplayStatus] Received:", status);
      setReplayStatus(status);
      
      // If confirmed and we're the requester, execute the replay
      if (status.confirmed && status.isRequester) {
        executeConfirmedReplay();
      }
    } catch (err) {
      console.error("Fetch replay status failed:", err);
    }
  }, [initData, sessionId, executeConfirmedReplay]);

  // Countdown timer for rate_limited status
  useEffect(() => {
    if (countdown === null || countdown <= 0) {
      setCountdown(null);
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown, retryAfterSeconds]);

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
        
        // Also fetch replay status for multiplayer
        if (sessionData.session.maxPlayers > 1) {
          await fetchReplayStatus();
        }
      } catch (err) {
        console.error("Fetch failed:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Poll for replay status (for multiplayer) and render status
    const interval = setInterval(async () => {
      try {
        // Check session status first - if not "ready", replay was executed, redirect both players
        const sessionData = await api.getSession(initData, sessionId);
        if (sessionData.session.status !== "ready") {
          // Replay was executed (status changed to "recording" or other), redirect both players
          console.log("[Polling] Session status changed to:", sessionData.session.status, "- redirecting after replay");
          window.location.href = `/s/${sessionId}`;
          return;
        }
        
        // For multiplayer, always poll replay status to catch incoming requests
        if (isMultiplayer) {
          await fetchReplayStatus();
        }
        
        // Poll render status if not ready yet (for both solo and multiplayer)
        if (render?.status !== "ready") {
          const data = await api.getRenderStatus(initData, sessionId);
          
          // Only show "failed" after 3 consecutive failures (avoid false positives)
          if (data.status === "failed") {
            setRenderErrorCount(prev => {
              const newCount = prev + 1;
              if (newCount >= 3) {
                setRender(data); // Only show failed after 3 tries
              }
              return newCount;
            });
          } else {
            setRenderErrorCount(0); // Reset error count on success
            setRender(data);
          }
        }
      } catch {
        // ignore network errors
      }
    }, 5000); // 5 seconds to avoid rate limit and give FFmpeg time

    return () => {
      clearInterval(interval);
      // Cleanup send status polling on unmount
      if (sendStatusPollTimeoutRef.current) {
        clearTimeout(sendStatusPollTimeoutRef.current);
        sendStatusPollTimeoutRef.current = null;
      }
    };
  }, [isReady, initData, sessionId, session?.session.maxPlayers, fetchReplayStatus]);

  const handleReplay = async (mode: "sameScene" | "newScene", skipConfirm = false) => {
    if (!initData || replaying) return;
    
    // Show confirmation only if video was NOT sent
    if (!sent && !skipConfirm) {
      setShowNewSceneConfirm(mode);
      return;
    }
    
    setReplaying(mode);
    
    try {
      // For multiplayer, request confirmation from other player
      if (isMultiplayer) {
        const result = await api.requestReplay(initData, sessionId, mode);
        
        if (result.directReplay) {
          // Solo game - do direct replay
          await api.replaySession(initData, sessionId, mode);
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
          setSent(false);
          setShowNewSceneConfirm(null);
          window.location.href = `/s/${sessionId}`;
        } else if (result.waitingForConfirmation) {
          // Multiplayer - waiting for confirmation
          setWaitingForConfirmation(true);
          setShowNewSceneConfirm(null);
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
        }
      } else {
        // Solo - direct replay
        await api.replaySession(initData, sessionId, mode);
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
        setSent(false);
        setShowNewSceneConfirm(null);
        window.location.href = `/s/${sessionId}`;
      }
    } catch (err) {
      console.error("Replay failed:", err);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
    } finally {
      setReplaying(null);
    }
  };

  const handleConfirmReplay = async (confirm: boolean) => {
    if (!initData) return;
    setConfirmingReplay(true);
    
    try {
      const result = await api.confirmReplay(initData, sessionId, confirm);
      
      if (result.confirmed && result.mode) {
        // Confirmed - execute replay directly (using the original replay API)
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
        await api.replaySession(initData, sessionId, result.mode as "sameScene" | "newScene");
        // Use window.location for clean navigation (avoids caching issues)
        window.location.href = `/s/${sessionId}`;
      } else {
        // Declined - just reset state
        setReplayStatus({ pending: false });
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("warning");
      }
    } catch (err) {
      console.error("Confirm replay failed:", err);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
    } finally {
      setConfirmingReplay(false);
    }
  };

  const handleSendToTelegram = async () => {
    if (!initData || sending || sent) return;
    
    setSending(true);
    setSendError(null);
    setRetryAfterSeconds(null);
    setCountdown(null);
    
    try {
      const result = await api.sendVideoToTelegram(initData, sessionId);
      
      if (result.status === "queued") {
        // Job queued - start polling for status with backoff
        setSending(true);
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
        
        // Clear any existing timeout
        if (sendStatusPollTimeoutRef.current) {
          clearTimeout(sendStatusPollTimeoutRef.current);
        }
        
        // Reset polling state
        sendStatusPollAttemptRef.current = 0;
        sendStatusPollStartTimeRef.current = Date.now();
        
        // Backoff intervals: 3s, 3s, 5s, 8s, 13s, потом 15s (макс)
        const backoffIntervals = [3000, 3000, 5000, 8000, 13000, 15000];
        const MAX_POLL_DURATION = 180000; // 180 seconds
        
        const pollSendStatus = async () => {
          try {
            const statusResult = await api.getSendStatus(initData, sessionId);
            
            // Handle rate_limited status (show neutral message with timer, continue polling)
            if (statusResult.status === "rate_limited") {
              // Use retryAfterSeconds from API response
              const retryAfter = statusResult.retryAfterSeconds || 60;
              setRetryAfterSeconds(retryAfter);
              // Update countdown if it's different (in case retry_after changed)
              if (countdown === null || countdown !== retryAfter) {
                setCountdown(retryAfter);
              }
              setSendError(null); // Don't show as error - it's a rate limit, not a failure
              // Continue polling - don't stop
            } else if (statusResult.status === "sent") {
              // SUCCESS: Stop polling, unlock UI, show success state
              if (sendStatusPollTimeoutRef.current) {
                clearTimeout(sendStatusPollTimeoutRef.current);
                sendStatusPollTimeoutRef.current = null;
              }
              
              setSent(true);
              setSending(false); // Unlock UI
              setSendError(null);
              setRetryAfterSeconds(null);
              setCountdown(null);
              window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
              return; // Stop polling
            } else if (statusResult.status === "failed" || statusResult.status === "too_large") {
              // ERROR: Stop polling, show error
              if (sendStatusPollTimeoutRef.current) {
                clearTimeout(sendStatusPollTimeoutRef.current);
                sendStatusPollTimeoutRef.current = null;
              }
              
              setSending(false); // Unlock UI even on error
              setSendError(statusResult.error || "Не удалось отправить видео");
              setRetryAfterSeconds(null);
              setCountdown(null);
              window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
              return; // Stop polling
            }
            
            // Check timeout
            const elapsed = Date.now() - sendStatusPollStartTimeRef.current;
            if (elapsed >= MAX_POLL_DURATION) {
              if (sendStatusPollTimeoutRef.current) {
                clearTimeout(sendStatusPollTimeoutRef.current);
                sendStatusPollTimeoutRef.current = null;
              }
              setSending(false);
              setSendError("Отправка занимает слишком много времени. Попробуйте позже.");
              return;
            }
            
            // Continue polling with backoff (queued or sending)
            const attemptIndex = Math.min(sendStatusPollAttemptRef.current, backoffIntervals.length - 1);
            const delay = backoffIntervals[attemptIndex];
            sendStatusPollAttemptRef.current++;
            
            sendStatusPollTimeoutRef.current = setTimeout(pollSendStatus, delay);
          } catch (err) {
            console.error("Poll send status failed:", err);
            
            // Check timeout even on error
            const elapsed = Date.now() - sendStatusPollStartTimeRef.current;
            if (elapsed >= MAX_POLL_DURATION) {
              if (sendStatusPollTimeoutRef.current) {
                clearTimeout(sendStatusPollTimeoutRef.current);
                sendStatusPollTimeoutRef.current = null;
              }
              setSending(false);
              setSendError("Отправка занимает слишком много времени. Попробуйте позже.");
              return;
            }
            
            // Continue polling with backoff even on error
            const attemptIndex = Math.min(sendStatusPollAttemptRef.current, backoffIntervals.length - 1);
            const delay = backoffIntervals[attemptIndex];
            sendStatusPollAttemptRef.current++;
            sendStatusPollTimeoutRef.current = setTimeout(pollSendStatus, delay);
          }
        };
        
        // Start polling with first interval (3s)
        const firstDelay = backoffIntervals[0];
        sendStatusPollTimeoutRef.current = setTimeout(pollSendStatus, firstDelay);
      } else if (result.status === "sent") {
        setSent(true);
        setSending(false);
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      } else {
        setSending(false);
        setSendError(result.error || result.message || "Не удалось отправить");
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
      }
    } catch (err: any) {
      console.error("Send failed:", err);
      setSending(false);
      setSendError(err.message || "Ошибка отправки");
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
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

        {/* Video - add fixed timestamp to bust cache after replay */}
        <div className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <VideoPlayer
            src={render.videoUrl ? `${render.videoUrl}?t=${cacheTimestamp}` : ""}
            muted={false}
            showTimeRange={false}
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

        {/* Waiting for confirmation banner - only show for requester */}
        {waitingForConfirmation && replayStatus.isRequester && (
          <div className="card bg-yellow-500/20 border border-yellow-500/40 animate-pulse">
            <div className="text-center">
              <div className="text-2xl mb-2">⏳</div>
              <p className="font-medium">Ждём подтверждения от партнёра...</p>
              <p className="text-sm text-tg-hint mt-1">
                Другой игрок должен подтвердить запуск новой игры
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3 animate-fade-in" style={{ animationDelay: "0.2s" }}>
          {/* Send to Telegram - prominent */}
          <button
            onClick={handleSendToTelegram}
            disabled={sending || sent}
            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-colors ${
              sent 
                ? "bg-green-500 text-white" 
                : sendError
                  ? "bg-red-500 hover:bg-red-600 text-white" 
                  : "btn-primary"
            } disabled:opacity-70`}
          >
            {sent ? (
              <>✅ Отправлено в чат!</>
            ) : sending ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {retryAfterSeconds !== null && countdown !== null ? (
                  <>Ожидаем, повторим через {countdown} сек</>
                ) : sendError ? (
                  <>Повторная отправка...</>
                ) : (
                  <>Отправляем...</>
                )}
              </>
            ) : sendError ? (
              <>🔄 Повторить отправку</>
            ) : (
              <>📥 Сохранить в Telegram</>
            )}
          </button>
          
          {/* Rate limit message (neutral, not an error) - shown separately from button */}
          {retryAfterSeconds !== null && countdown !== null && countdown > 0 && !sent && (
            <div className="text-center text-sm text-yellow-400">
              ⏳ Telegram ограничил скорость, повторим через ~{countdown} сек
            </div>
          )}
          
          {/* Error message (only for real errors, not rate_limited) */}
          {sendError && !sent && retryAfterSeconds === null && (
            <div className="text-center text-sm text-red-400">
              ❌ {sendError}
            </div>
          )}

          {/* Replay buttons - disabled when waiting */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleReplay("sameScene")}
              disabled={replaying !== null || waitingForConfirmation}
              className="btn-primary disabled:opacity-70"
            >
              {replaying === "sameScene" ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block mr-2" />
                  ...
                </>
              ) : (
                <>🔄 Еще раз</>
              )}
            </button>
            <button
              onClick={() => handleReplay("newScene")}
              disabled={replaying !== null || waitingForConfirmation}
              className="btn-primary disabled:opacity-70"
            >
              {replaying === "newScene" ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block mr-2" />
                  ...
                </>
              ) : (
                <>🎲 Новая сцена</>
              )}
            </button>
          </div>
        </div>

        {/* "Unsent video" Confirmation Dialog */}
        {showNewSceneConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50 animate-fade-in">
            <div className="card max-w-sm w-full space-y-4 animate-slide-up">
              <div className="text-center">
                <div className="text-4xl mb-3">⚠️</div>
                <h3 className="text-lg font-bold mb-2">
                  {showNewSceneConfirm === "newScene" ? "Новая сцена" : "Еще раз"}
                </h3>
                <p className="text-sm text-tg-hint">
                  Текущее видео не сохранится. Вы уверены, что хотите начать новую игру?
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowNewSceneConfirm(null)}
                  className="btn-secondary"
                >
                  Отмена
                </button>
                <button
                  onClick={() => handleReplay(showNewSceneConfirm, true)}
                  className="btn-primary"
                >
                  ОК
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Multiplayer Replay Confirmation Dialog (for other player) */}
        {replayStatus.pending && !replayStatus.isRequester && !replayStatus.confirmed && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50 animate-fade-in">
            <div className="card max-w-sm w-full space-y-4 animate-slide-up">
              <div className="text-center">
                <div className="text-4xl mb-3">🎮</div>
                <h3 className="text-lg font-bold mb-2">
                  {replayStatus.mode === "newScene" ? "Новая сцена" : "Повторить игру"}
                </h3>
                <p className="text-sm text-tg-hint">
                  <span className="font-medium text-white">{replayStatus.requestedByName}</span> хочет {replayStatus.mode === "newScene" ? "начать новую сцену" : "повторить текущую сцену"}. Вы согласны?
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleConfirmReplay(false)}
                  disabled={confirmingReplay}
                  className="btn-secondary disabled:opacity-70"
                >
                  {confirmingReplay ? "..." : "Нет"}
                </button>
                <button
                  onClick={() => handleConfirmReplay(true)}
                  disabled={confirmingReplay}
                  className="btn-primary disabled:opacity-70"
                >
                  {confirmingReplay ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                  ) : "Да, поехали!"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

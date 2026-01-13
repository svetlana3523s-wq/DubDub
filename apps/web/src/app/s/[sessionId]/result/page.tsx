"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import { PlyrVideoPlayer } from "@/components/PlyrVideoPlayer";
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
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
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

  // Fetch replay status and session status
  const fetchReplayStatus = useCallback(async () => {
    if (!initData) return;
    try {
      // Check session status first - if not "ready", replay already happened
      const sessionData = await api.getSession(initData, sessionId);
      if (sessionData.session.status !== "ready") {
        // Replay already executed, redirect to session (use window.location for clean navigation)
        console.log("[Polling] Session status changed to:", sessionData.session.status, "- redirecting");
        window.location.href = `/s/${sessionId}?t=${Date.now()}`;
        return;
      }
      
      const status = await api.getReplayStatus(initData, sessionId);
      console.log("[ReplayStatus] Received:", status);
      setReplayStatus(status);
      
      // If confirmed and we're the requester, execute the replay
      // Only requester executes - non-requester will be redirected by session.status change above
      if (status.confirmed && status.isRequester) {
        executeConfirmedReplay();
      }
      // Non-requester: don't redirect here, let session.status polling handle it
      // This prevents race condition where redirect happens before execute-replay completes
    } catch (err) {
      console.error("Fetch replay status failed:", err);
    }
  }, [initData, sessionId]);

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

    return () => clearInterval(interval);
  }, [isReady, initData, sessionId, session?.session.maxPlayers, fetchReplayStatus]);

  // Execute confirmed replay
  const executeConfirmedReplay = async () => {
    if (!initData) return;
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
  };

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
    
    try {
      const result = await api.sendVideoToTelegram(initData, sessionId);
      if (result.sent) {
        setSent(true);
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      } else {
        setSendError(result.error || "Не удалось отправить");
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
      }
    } catch (err: any) {
      console.error("Send failed:", err);
      setSendError(err.message || "Ошибка отправки");
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

        {/* Video - add timestamp to bust cache after replay */}
        <div className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <PlyrVideoPlayer
            src={render.videoUrl ? `${render.videoUrl}?t=${Date.now()}` : ""}
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
                Отправляем...
              </>
            ) : sendError ? (
              <>🔄 Повторить отправку</>
            ) : (
              <>📥 Сохранить в Telegram</>
            )}
          </button>
          
          {/* Error message */}
          {sendError && !sent && (
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

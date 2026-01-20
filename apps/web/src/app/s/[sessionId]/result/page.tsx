"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import { VideoPlayer } from "@/components/VideoPlayer";
import { RU } from "@dubdub/shared";
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
  const [sendStatus, setSendStatus] = useState<string | null>(null);
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
  const effectiveSendStatus = sendStatus || (sent ? "sent" : sending ? "sending" : null);

  // Track render error count for retry logic
  const [renderErrorCount, setRenderErrorCount] = useState(0);
  
  // Ref for send status polling
  const sendStatusPollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sendStatusPollAttemptRef = useRef<number>(0);
  const sendStatusPollStartTimeRef = useRef<number>(0);
  const sendStatusPollInProgressRef = useRef<boolean>(false);

  const stopSendStatusPolling = useCallback(() => {
    if (sendStatusPollTimeoutRef.current) {
      clearTimeout(sendStatusPollTimeoutRef.current);
      sendStatusPollTimeoutRef.current = null;
    }
    sendStatusPollInProgressRef.current = false;
  }, []);

  const startSendStatusPolling = useCallback(
    (initialDelayMs = 3000) => {
      if (!initData) return;
      if (sendStatusPollInProgressRef.current) return;

      sendStatusPollInProgressRef.current = true;
      setSending(true);
      setSendStatus("sending");
      setSendError(null);
      setRetryAfterSeconds(null);
      setCountdown(null);

      sendStatusPollAttemptRef.current = 0;
      sendStatusPollStartTimeRef.current = Date.now();

      const backoffIntervals = [3000, 3000, 5000, 8000, 13000, 15000];
      const MAX_POLL_DURATION = 180000; // 180 seconds

      const scheduleNext = () => {
        if (!sendStatusPollInProgressRef.current) return;

        const elapsed = Date.now() - sendStatusPollStartTimeRef.current;
        if (elapsed >= MAX_POLL_DURATION) {
          stopSendStatusPolling();
          setSending(false);
          setSendError(RU.web.result.sendTimeout);
          return;
        }

        const attemptIndex = Math.min(
          sendStatusPollAttemptRef.current,
          backoffIntervals.length - 1
        );
        const delay = backoffIntervals[attemptIndex];
        sendStatusPollAttemptRef.current++;

        sendStatusPollTimeoutRef.current = setTimeout(pollSendStatus, delay);
      };

      const pollSendStatus = async () => {
        try {
          const statusResult = await api.getSendStatus(initData, sessionId);
          setSendStatus(statusResult.status);

          if (statusResult.status === "rate_limited") {
            const retryAfter = statusResult.retryAfterSeconds || 60;
            setRetryAfterSeconds(retryAfter);
            setCountdown(retryAfter);
            setSendError(null);
          } else if (statusResult.status === "sent") {
            stopSendStatusPolling();
            setSendStatus("sent");
            setSent(true);
            setSending(false);
            setSendError(null);
            setRetryAfterSeconds(null);
            setCountdown(null);
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
            return;
          } else if (statusResult.status === "failed" || statusResult.status === "too_large") {
            const errorMessage =
              statusResult.status === "too_large"
                ? RU.web.result.sendStatusTooLarge
                : RU.web.result.sendStatusFailed;
            stopSendStatusPolling();
            setSendStatus(statusResult.status);
            setSending(false);
            setSendError(errorMessage);
            setRetryAfterSeconds(null);
            setCountdown(null);
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
            return;
          } else {
            setRetryAfterSeconds(null);
            setCountdown(null);
          }
        } catch (err) {
          console.error("Poll send status failed:", err);
        }

        scheduleNext();
      };

      sendStatusPollTimeoutRef.current = setTimeout(pollSendStatus, initialDelayMs);
    },
    [initData, sessionId, stopSendStatusPolling]
  );

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
      stopSendStatusPolling();
    };
  }, [isReady, initData, sessionId, session?.session.maxPlayers, fetchReplayStatus, stopSendStatusPolling]);

  useEffect(() => {
    if (!isReady || !initData) return;

    let cancelled = false;

    const initSendStatus = async () => {
      try {
        const statusResult = await api.getSendStatus(initData, sessionId);
        if (cancelled) return;
        setSendStatus(statusResult.status);

        if (statusResult.status === "sent") {
          stopSendStatusPolling();
          setSendStatus("sent");
          setSent(true);
          setSending(false);
          setSendError(null);
          setRetryAfterSeconds(null);
          setCountdown(null);
          return;
        }

        if (statusResult.status === "failed" || statusResult.status === "too_large") {
          const errorMessage =
              statusResult.status === "too_large"
                ? RU.web.result.sendStatusTooLarge
                : RU.web.result.sendStatusFailed;
          stopSendStatusPolling();
          setSendStatus(statusResult.status);
          setSending(false);
          setSendError(errorMessage);
          setRetryAfterSeconds(null);
          setCountdown(null);
          return;
        }

        if (
          statusResult.status === "queued" ||
          statusResult.status === "sending" ||
          statusResult.status === "rate_limited"
        ) {
          setSendStatus(statusResult.status);
          if (statusResult.status === "rate_limited") {
            const retryAfter = statusResult.retryAfterSeconds || 60;
            setRetryAfterSeconds(retryAfter);
            setCountdown(retryAfter);
          }
          startSendStatusPolling(3000);
        } else if (statusResult.status === "unknown" && render?.status === "ready") {
          startSendStatusPolling(3000);
        }
      } catch {
        // ignore init polling errors
      }
    };

    initSendStatus();

    return () => {
      cancelled = true;
    };
  }, [isReady, initData, render?.status, sessionId, startSendStatusPolling, stopSendStatusPolling]);

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
          <div className="text-5xl">{RU.web.result.renderFailEmoji()}</div>
          <h2 className="text-xl font-bold">{RU.web.result.renderFailedTitle}</h2>
          <p className="text-tg-hint">{RU.web.result.renderFailedSubtitle}</p>
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
              {RU.web.result.renderEmoji()}
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold mb-2">{RU.web.result.renderInProgressTitle}</h2>
            <p className="text-tg-hint">{RU.web.result.renderInProgressSubtitle}</p>
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
          <div className="text-4xl mb-3">{RU.web.result.readyEmoji()}</div>
          <h1 className="text-2xl font-bold mb-1">{RU.web.result.readyTitle}</h1>
          <p className="text-tg-hint">{RU.web.result.readySubtitle}</p>
        </div>

        {/* Task (only in tasks mode) */}
        {session && session.session.gameMode === "tasks" && session.session.task && (
          <div className="card text-center animate-fade-in">
            <div className="text-sm text-tg-hint mb-1">{RU.web.result.taskLabel()}</div>
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
              <div className="text-2xl mb-2">{RU.web.result.waitingConfirmTitle()}</div>
              <p className="font-medium">{RU.web.result.waitingConfirmBody}</p>
              <p className="text-sm text-tg-hint mt-1">{RU.web.result.waitingConfirmHint}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3 animate-fade-in" style={{ animationDelay: "0.2s" }}>
          {/* Delivery status */}
          <div className="card text-center">
            {effectiveSendStatus === "sent" ? (
              <p className="text-green-500">
                {RU.web.result.sendStatusSent}
              </p>
            ) : effectiveSendStatus === "rate_limited" && retryAfterSeconds !== null && countdown !== null ? (
              <p className="text-yellow-400">
                {RU.web.result.sendStatusRateLimited(countdown)}
              </p>
            ) : sendError ? (
              <p className="text-red-400">{sendError}</p>
            ) : (
              <p>{RU.web.result.sendStatusSending}</p>
            )}
          </div>


                    <button
            type="button"
            onClick={() => window.alert(RU.web.result.gameId(sessionId))}
            className="w-full btn-secondary"
          >
            {RU.web.result.showGameId}
          </button>

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
                  {RU.web.result.replayConfirmLoading}
                </>
              ) : (
                <>{RU.web.result.replaySame()}</>
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
                  {RU.web.result.replayConfirmLoading}
                </>
              ) : (
                <>{RU.web.result.replayNew()}</>
              )}
            </button>
          </div>
        </div>

        {/* "Unsent video" Confirmation Dialog */}
        {showNewSceneConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50 animate-fade-in">
            <div className="card max-w-sm w-full space-y-4 animate-slide-up">
              <div className="text-center">
                <div className="text-4xl mb-3">{RU.web.result.warningEmoji()}</div>
                <h3 className="text-lg font-bold mb-2">
                  {showNewSceneConfirm === "newScene"
                    ? RU.web.result.confirmTitleNew
                    : RU.web.result.confirmTitleSame}
                </h3>
                <p className="text-sm text-tg-hint">{RU.web.result.confirmBody}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowNewSceneConfirm(null)}
                  className="btn-secondary"
                >{RU.web.result.confirmCancel}</button>
                <button
                  onClick={() => handleReplay(showNewSceneConfirm, true)}
                  className="btn-primary"
                >{RU.web.result.confirmOk}</button>
              </div>
            </div>
          </div>
        )}

        {/* Multiplayer Replay Confirmation Dialog (for other player) */}
        {replayStatus.pending && !replayStatus.isRequester && !replayStatus.confirmed && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50 animate-fade-in">
            <div className="card max-w-sm w-full space-y-4 animate-slide-up">
              <div className="text-center">
                <div className="text-4xl mb-3">{RU.web.result.replayEmoji()}</div>
                <h3 className="text-lg font-bold mb-2">
                  {replayStatus.mode === "newScene"
                    ? RU.web.result.replayRequestTitleNew
                    : RU.web.result.replayRequestTitleSame}
                </h3>
                <p className="text-sm text-tg-hint">
                  {RU.web.result.replayRequestBody(
                    replayStatus.requestedByName || "",
                    replayStatus.mode === "newScene" ? "newScene" : "sameScene"
                  )}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleConfirmReplay(false)}
                  disabled={confirmingReplay}
                  className="btn-secondary disabled:opacity-70"
                >{confirmingReplay ? RU.web.result.replayConfirmLoading : RU.web.result.replayConfirmNo}</button>
                <button
                  onClick={() => handleConfirmReplay(true)}
                  disabled={confirmingReplay}
                  className="btn-primary disabled:opacity-70"
                >{confirmingReplay ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                  ) : RU.web.result.replayConfirmYes}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

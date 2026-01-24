"use client";

import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api, getLastApiError } from "@/lib/api";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { RU } from "@dubdub/shared";
import type { RenderStatusResponse, SessionStateResponse } from "@dubdub/shared";

interface PageProps {
  params: { sessionId: string };
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen text-white relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -right-20 h-72 w-72 rounded-full bg-purple-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-blue-500/30 blur-3xl" />
      <div className="relative min-h-screen safe-bottom">{children}</div>
    </div>
  );
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
  const { isReady, initData, user } = useTelegram();
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
  const [lastStatusAt, setLastStatusAt] = useState<number | null>(null);
  const [statusStale, setStatusStale] = useState(false);
  const [lastPollAt, setLastPollAt] = useState<number | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [sessionRateLimitCountdown, setSessionRateLimitCountdown] = useState<number | null>(null);
  
  // Multiplayer replay confirmation
  const [replayStatus, setReplayStatus] = useState<ReplayStatus>({ pending: false });
  const [waitingForConfirmation, setWaitingForConfirmation] = useState(false);
  const [confirmingReplay, setConfirmingReplay] = useState(false);
  const [replayResponseSent, setReplayResponseSent] = useState(false);

  // Check if this is a multiplayer session
  const isMultiplayer = session && session.session.maxPlayers > 1;
  const canReplay = !isMultiplayer || !replayStatus.pending;

  // Track render error count for retry logic
  const [renderErrorCount, setRenderErrorCount] = useState(0);
  
  // Ref for send status polling
  const sendStatusPollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sendStatusPollAttemptRef = useRef<number>(0);
  const sendStatusPollStartTimeRef = useRef<number>(0);
  const sendStatusPollInProgressRef = useRef<boolean>(false);
  const statusStaleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debugLongPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sessionRateLimitUntilRef = useRef<number>(0);

  const stopSendStatusPolling = useCallback(() => {
    if (sendStatusPollTimeoutRef.current) {
      clearTimeout(sendStatusPollTimeoutRef.current);
      sendStatusPollTimeoutRef.current = null;
    }
    if (statusStaleTimeoutRef.current) {
      clearTimeout(statusStaleTimeoutRef.current);
      statusStaleTimeoutRef.current = null;
    }
    sendStatusPollInProgressRef.current = false;
  }, []);

  const startSendStatusPolling = useCallback(
    (initialDelayMs = 3000) => {
      if (!initData) return;
      if (sendStatusPollInProgressRef.current) return;

      sendStatusPollInProgressRef.current = true;
      setSending(true);
      setSendStatus(null);
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
        const pollStartedAt = Date.now();
        setLastPollAt(pollStartedAt);
        try {
          const statusResult = await api.getSendStatus(initData, sessionId);
          const now = Date.now();
          setLastStatusAt(now);
          setStatusStale(false);
          if (statusStaleTimeoutRef.current) {
            clearTimeout(statusStaleTimeoutRef.current);
          }
          statusStaleTimeoutRef.current = setTimeout(() => {
            setStatusStale(true);
          }, 20000);
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
          stopSendStatusPolling();
          setSendStatus("unknown");
          setSending(false);
          setSendError(RU.web.result.sendStatusFailed);
          setRetryAfterSeconds(null);
          setCountdown(null);
          setStatusStale(true);
          setLastPollAt(Date.now());
          return;
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

  const getRetryAfterSeconds = (err: any) => {
    const status = err?.status;
    const retryAfter = err?.retryAfterSeconds;
    if (status === 429) {
      return typeof retryAfter === "number" && retryAfter > 0 ? retryAfter : 10;
    }
    return null;
  };

  // Fetch replay status and session status
  const fetchReplayStatus = useCallback(async () => {
    if (!initData) return;
    try {
      const status = await api.getReplayStatus(initData, sessionId);
      console.log("[ReplayStatus] Received:", status);
      setReplayStatus(status);
      setWaitingForConfirmation(!!status.pending && !!status.isRequester);
      if (!status.pending) {
        setReplayResponseSent(false);
      }
      
      // If confirmed and we're the requester, execute the replay
      if (status.confirmed && status.isRequester) {
        executeConfirmedReplay();
      }
    } catch (err) {
      const retryAfter = getRetryAfterSeconds(err);
      if (retryAfter !== null) {
        sessionRateLimitUntilRef.current = Date.now() + retryAfter * 1000;
        setSessionRateLimitCountdown(retryAfter);
        return;
      }
      console.error("Fetch replay status failed:", err);
    }
  }, [initData, sessionId, executeConfirmedReplay, getRetryAfterSeconds]);

  // Countdown timer for rate_limited status
  useEffect(() => {
    setDebugMode(new URLSearchParams(window.location.search).has("debug"));
  }, []);

  useEffect(() => {
    return () => {
      if (debugLongPressTimeoutRef.current) {
        clearTimeout(debugLongPressTimeoutRef.current);
        debugLongPressTimeoutRef.current = null;
      }
    };
  }, []);

  const handleDebugPressStart = () => {
    if (debugEnabled) return;
    if (debugLongPressTimeoutRef.current) {
      clearTimeout(debugLongPressTimeoutRef.current);
    }
    debugLongPressTimeoutRef.current = setTimeout(() => {
      setDebugEnabled(true);
    }, 3000);
  };

  const handleDebugPressEnd = () => {
    if (debugLongPressTimeoutRef.current) {
      clearTimeout(debugLongPressTimeoutRef.current);
      debugLongPressTimeoutRef.current = null;
    }
  };

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
    if (sessionRateLimitCountdown === null || sessionRateLimitCountdown <= 0) {
      setSessionRateLimitCountdown(null);
      return;
    }

    const timer = setInterval(() => {
      setSessionRateLimitCountdown((prev) => {
        if (prev === null || prev <= 1) {
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [sessionRateLimitCountdown]);

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
    const intervalMs = replayStatus.pending ? 2000 : 5000;
    const interval = setInterval(async () => {
      if (Date.now() < sessionRateLimitUntilRef.current) {
        return;
      }
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
      } catch (err) {
        const retryAfter = getRetryAfterSeconds(err);
        if (retryAfter !== null) {
          sessionRateLimitUntilRef.current = Date.now() + retryAfter * 1000;
          setSessionRateLimitCountdown(retryAfter);
          return;
        }
        // ignore other network errors
      }
    }, intervalMs);

    return () => {
      clearInterval(interval);
      // Cleanup send status polling on unmount
      stopSendStatusPolling();
    };
  }, [isReady, initData, sessionId, session?.session.maxPlayers, fetchReplayStatus, stopSendStatusPolling, getRetryAfterSeconds, replayStatus.pending]);

  useEffect(() => {
    if (!isReady || !initData) return;

    let cancelled = false;

    const initSendStatus = async () => {
      try {
        const statusResult = await api.getSendStatus(initData, sessionId);
        if (cancelled) return;
        setLastPollAt(Date.now());
        const now = Date.now();
        setLastStatusAt(now);
        setStatusStale(false);
        if (statusStaleTimeoutRef.current) {
          clearTimeout(statusStaleTimeoutRef.current);
        }
        statusStaleTimeoutRef.current = setTimeout(() => {
          setStatusStale(true);
        }, 20000);
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
        stopSendStatusPolling();
        setSendStatus("unknown");
        setSending(false);
        setSendError(RU.web.result.sendStatusFailed);
        setRetryAfterSeconds(null);
        setCountdown(null);
        setStatusStale(true);
      }
    };

    initSendStatus();

    return () => {
      cancelled = true;
    };
  }, [isReady, initData, render?.status, sessionId, startSendStatusPolling, stopSendStatusPolling]);

  useEffect(() => {
    if (!render || render.status !== "ready") return;
    if (sent) return;
    if (sendStatusPollInProgressRef.current) return;
    startSendStatusPolling(3000);
  }, [render?.status, sent, startSendStatusPolling]);

  const handleReplay = async (mode: "sameScene" | "newScene") => {
    if (!initData || replaying) return;
    if (!canReplay) {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("warning");
      return;
    }
    
    setReplaying(mode);
    
    try {
      if (!isMultiplayer) {
        // Direct replay for solo
        await api.replaySession(initData, sessionId, mode);
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
        setSent(false);
        window.location.href = `/s/${sessionId}`;
        return;
      }

      const result = await api.requestReplay(initData, sessionId, mode);
      if (result.directReplay) {
        await api.replaySession(initData, sessionId, mode);
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
        setSent(false);
        window.location.href = `/s/${sessionId}`;
        return;
      }

      if (result.pending) {
        setReplayStatus({
          pending: true,
          mode: result.mode,
          requestedByName: result.requestedByName,
          isRequester: result.isRequester,
          confirmed: result.confirmed,
        });
        setWaitingForConfirmation(!!result.isRequester);
        setReplayResponseSent(false);
        return;
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
      
      if (result.confirmed) {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
        setReplayResponseSent(true);
        await fetchReplayStatus();
      } else {
        setReplayStatus({ pending: false });
        setWaitingForConfirmation(false);
        setReplayResponseSent(false);
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
      <PageShell>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-12 h-12 border-3 border-accent-primary border-t-transparent rounded-full animate-spin" />
      </div>
      </PageShell>
    );
  }

  if (!render || render.status === "failed") {
    return (
      <PageShell>
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="text-5xl">{RU.web.result.renderFailEmoji()}</div>
          <h2 className="text-xl font-bold">{RU.web.result.renderFailedTitle}</h2>
          <p className="text-tg-hint">{RU.web.result.renderFailedSubtitle}</p>
        </div>
      </div>
      </PageShell>
    );
  }

  if (render.status !== "ready" || !render.videoUrl) {
    return (
      <PageShell>
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
      </PageShell>
    );
  }

  const effectiveSendStatus = sendStatus ?? (sent ? "sent" : null);
  const showDebug = debugMode || debugEnabled;

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
          <Card className="text-center animate-fade-in">
            <div className="text-sm text-tg-hint mb-1">{RU.web.result.taskLabel()}</div>
            <div className="font-medium">{session.session.task}</div>
          </Card>
        )}

        {/* Video - add fixed timestamp to bust cache after replay */}
        <Card className="animate-fade-in p-3" style={{ animationDelay: "0.1s" }}>
          <VideoPlayer
            src={render.videoUrl ? `${render.videoUrl}?t=${cacheTimestamp}` : ""}
            muted={false}
            showTimeRange={false}
          />
        </Card>

        {/* Players */}
        {session && (
          <Card className="flex justify-center gap-2 flex-wrap animate-fade-in" style={{ animationDelay: "0.15s" }}>
            {session.participants.map((p) => (
              <span
                key={p.id}
                className="px-3 py-1.5 bg-white/10 rounded-full text-sm border border-white/10"
              >
                {p.displayName}
              </span>
            ))}
          </Card>
        )}

        {/* Waiting for confirmation banner - only show for requester */}
        {waitingForConfirmation && replayStatus.isRequester && (
          <Card className="bg-yellow-500/20 border border-yellow-500/40 animate-pulse">
            <div className="text-center">
              <div className="text-2xl mb-2">{RU.web.result.waitingConfirmTitle()}</div>
              <p className="font-medium">{RU.web.result.waitingConfirmBody}</p>
              <p className="text-sm text-tg-hint mt-1">{RU.web.result.waitingConfirmHint}</p>
            </div>
          </Card>
        )}

        {/* Replay confirmation prompt - shown to responder */}
        {replayStatus.pending && !replayStatus.isRequester && (
          <Card className="bg-white/5 border border-white/10">
            <div className="text-center space-y-3">
              <div className="text-lg font-semibold">
                {replayStatus.mode === "newScene"
                  ? RU.web.result.replayRequestTitleNew
                  : RU.web.result.replayRequestTitleSame}
              </div>
              <p className="text-sm text-tg-hint">
                {RU.web.result.replayRequestBody(
                  replayStatus.requestedByName || RU.web.result.readyTitle,
                  (replayStatus.mode as "newScene" | "sameScene") || "newScene"
                )}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={() => handleConfirmReplay(false)}
                  disabled={confirmingReplay || replayResponseSent}
                  variant="secondary"
                >
                  {RU.web.result.replayConfirmNo}
                </Button>
                <Button
                  onClick={() => handleConfirmReplay(true)}
                  disabled={confirmingReplay || replayResponseSent}
                >
                  {confirmingReplay ? RU.web.result.replayConfirmLoading : RU.web.result.replayConfirmYes}
                </Button>
              </div>
              {replayResponseSent && (
                <p className="text-sm text-tg-hint">
                  {RU.web.result.replayConfirmSent}
                </p>
              )}
            </div>
          </Card>
        )}

        {/* Actions */}
        <div className="space-y-3 animate-fade-in" style={{ animationDelay: "0.2s" }}>
          {/* Delivery status */}
          <Card className="text-center">
            <p className="text-green-500">{RU.web.result.sendStatusAssumedSent}</p>
            {effectiveSendStatus === "rate_limited" &&
              retryAfterSeconds !== null &&
              countdown !== null && (
                <p className="text-yellow-400 mt-1">
                  {RU.web.result.sendStatusRateLimited(countdown)}
                </p>
              )}
            {(sendError ||
              effectiveSendStatus === "failed" ||
              effectiveSendStatus === "too_large") && (
              <p className="text-red-400 mt-1">
                {sendError || RU.web.result.sendStatusFailed}
              </p>
            )}
            {statusStale && (
              <p className="text-yellow-400 mt-1">Статус давно не обновлялся.</p>
            )}
            {sessionRateLimitCountdown !== null && (
              <p className="text-yellow-400 mt-1">
                Сервер ограничил скорость, повторим через {sessionRateLimitCountdown} сек.
              </p>
            )}
            {showDebug && (
              <p className="text-tg-hint mt-1">
                {`Last API error: ${(() => {
                  const last = getLastApiError();
                  if (!last) return "none";
                  const status = last.status ? ` ${last.status}` : "";
                  const code = last.code ? ` ${last.code}` : "";
                  const error = last.errorMessage ? ` ${last.errorMessage}` : "";
                  return `${last.path || "unknown"}${status}${code}${error}`;
                })()}`}
              </p>
            )}
            {showDebug && (
              <p className="text-tg-hint mt-1">
                {`Last send-status poll: ${lastPollAt ? new Date(lastPollAt).toLocaleTimeString() : "never"}`}
              </p>
            )}
          </Card>


          <Button
            type="button"
            onClick={() => window.alert(RU.web.result.gameId(sessionId))}
            onPointerDown={handleDebugPressStart}
            onPointerUp={handleDebugPressEnd}
            onPointerLeave={handleDebugPressEnd}
            onPointerCancel={handleDebugPressEnd}
            className="w-full"
            variant="secondary"
          >
            {RU.web.result.showGameId}
          </Button>

          {/* Replay buttons - disabled when waiting */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => handleReplay("sameScene")}
              disabled={replaying !== null || !canReplay}
              className="disabled:opacity-70"
            >
              {replaying === "sameScene" ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block mr-2" />
                  {RU.web.result.replayConfirmLoading}
                </>
              ) : (
                <>{RU.web.result.replaySame()}</>
              )}
            </Button>
            <Button
              onClick={() => handleReplay("newScene")}
              disabled={replaying !== null || !canReplay}
              className="disabled:opacity-70"
            >
              {replaying === "newScene" ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block mr-2" />
                  {RU.web.result.replayConfirmLoading}
                </>
              ) : (
                <>{RU.web.result.replayNew()}</>
              )}
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}

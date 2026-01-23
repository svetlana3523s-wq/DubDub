"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { RU } from "@dubdub/shared";
import type { SessionStateResponse, JoinSessionResponse } from "@dubdub/shared";

interface PageProps {
  params: { sessionId: string };
}

type ViewState = "loading" | "error" | "lobby" | "record" | "wait" | "finish" | "rendering";

const CATEGORY_LABELS: Record<string, string> = {
  movies: "???? ????????/??????????????",
  memes: "???? ????????",
  politics: "??????? ????????????????",
};

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen text-white relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -right-20 h-72 w-72 rounded-full bg-purple-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-blue-500/30 blur-3xl" />
      <div className="relative min-h-screen safe-bottom">{children}</div>
    </div>
  );
}


function SessionCodeCard({ sessionId }: { sessionId: string }) {
  const sessionCode = sessionId.slice(-8).toUpperCase();
  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME || "DubDubBot";
  
  // Deep link using ?start= (goes through bot first, more reliable)
  // The bot will find the session and show a button to open the Mini App
  const deepLink = `https://t.me/${botUsername}?start=join_${sessionCode}`;
  
  // Simple share text - the link itself contains the join info
  // Note: Telegram share API doesn't support Markdown, so code can't be monospace in the message
  const shareText = `🎬 Присоединяйся к озвучке!\n\nНажми на ссылку выше 👆`;

  const [copied, setCopied] = useState(false);
  
  const handleCopyCode = () => {
    navigator.clipboard.writeText(sessionCode);
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendToFriend = () => {
    // Use ?start= parameter - goes through bot's /start handler first
    // This is more reliable than ?startapp= because:
    // 1. Works for new users who need to start the bot first
    // 2. Bot finds the session and provides a proper "Join" button
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(deepLink)}&text=${encodeURIComponent(shareText)}`;
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
  };

  return (
    <Card className="animate-fade-in" style={{ animationDelay: "0.2s" }}>
      <div className="text-center space-y-4">
        <div>
          <div className="text-xs text-tg-hint mb-2">Код для присоединения</div>
          <button
            onClick={handleCopyCode}
            className="font-mono text-3xl font-bold tracking-wider text-accent-primary hover:text-accent-primary/80 cursor-pointer transition-colors"
            title="Нажми, чтобы скопировать"
          >
            {copied ? "✅ Скопировано!" : sessionCode}
          </button>
          <div className="text-xs text-tg-hint mt-1">
            👆 нажми, чтобы скопировать</div>
        </div>

        <Button
          variant="primary"
          onClick={handleSendToFriend}
          className="w-full"
        >
          📤 Отправить другу</Button>
      </div>
    </Card>
  );
}

export default function SessionPage({ params }: PageProps) {
  const { sessionId } = params;
  const router = useRouter();
  const { isReady, initData, user, retry } = useTelegram();

  const [viewState, setViewState] = useState<ViewState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionStateResponse | null>(null);
  const [joinData, setJoinData] = useState<JoinSessionResponse | null>(null);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [retakeUsed, setRetakeUsed] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const [skipInProgress, setSkipInProgress] = useState(false);

  const fetchSession = useCallback(async () => {
    if (!initData) return null;
    try {
      const data = await api.getSession(initData, sessionId);
      setSession(data);
      return data;
    } catch (err) {
      console.error("Fetch session failed:", err);
      return null;
    }
  }, [initData, sessionId]);

  const joinSession = useCallback(async () => {
    if (!initData) {
      console.error("[Join] No initData available", { isReady, initData: !!initData });
      setError("Telegram WebApp не инициализирован. Обновите страницу.");
      setViewState("error");
      return;
    }
    try {
      console.log("[Join] Attempting to join session", { sessionId });
      const data = await api.joinSession(initData, sessionId);
      console.log("[Join] Successfully joined", { participant: data.participant });
      setJoinData(data);
      return data;
    } catch (err) {
      console.error("[Join] Failed:", err);
      setError(err instanceof Error ? err.message : "Ошибка входа");
      setViewState("error");
    }
  }, [initData, sessionId, isReady]);

  const determineViewState = useCallback(
    (data: SessionStateResponse) => {
      if (data.session.status === "ready") {
        router.push(`/s/${sessionId}/result`);
        return;
      }

      if (data.session.status === "rendering") {
        setViewState("rendering");
        return;
      }

      const isSolo = data.session.maxPlayers === 1;
      const totalRoles = data.session.sceneMeta.cues.length;

      // In solo mode, check if all roles recorded (not just maxPlayers)
      // In multiplayer mode, check if all players recorded
      const requiredRecordings = isSolo ? totalRoles : data.session.maxPlayers;

      if (data.takes.length >= requiredRecordings) {
        setViewState("finish");
        return;
      }

      // Check if session is in lobby
      if (data.session.status === "lobby") {
        setViewState("lobby");
        return;
      }

      // In solo mode: always show record if there are more roles to record
      // In multiplayer: check if it's your turn
      if (isSolo) {
        if (data.myRoleIndex !== null && data.takes.length < totalRoles) {
          setHasRecorded(false);  // Reset for next role
          setRetakeUsed(false);   // Reset retake for next role
          setViewState("record");
        } else {
          setViewState("finish");
        }
      } else {
        // Multiplayer logic (2 players) - parallel recording
        const myTakeExists = data.takes.some(
          (t) => t.roleIndex === data.myRoleIndex
        );

        if (myTakeExists) {
          // Already recorded - wait for others
          setHasRecorded(true);
          if (data.takes.length >= data.session.maxPlayers) {
            setViewState("finish");
          } else {
            setViewState("wait");
          }
          return;
        }

        // Not recorded yet - can record now (parallel recording, no turn check)
        if (data.myRoleIndex !== null && data.session.status === "recording") {
          setViewState("record");
        } else {
          setViewState("wait");
        }
      }
    },
    [router, sessionId]
  );

  // Initial load
  useEffect(() => {
    console.log("[Init] Component mounted/updated", { isReady, hasInitData: !!initData, sessionId });
    
    if (!isReady) {
      console.log("[Init] Waiting for Telegram to be ready...");
      return;
    }

    if (!initData) {
      console.error("[Init] Telegram ready but no initData!", { isReady, initData });
      setError("Не удалось получить данные авторизации. Откройте приложение через бота.");
      setViewState("error");
      return;
    }

    const init = async () => {
      console.log("[Init] Starting initialization...");
      const joined = await joinSession();
      if (!joined) {
        console.error("[Init] Failed to join session");
        return;
      }

      // Immediately fetch session after joining
      console.log("[Init] Fetching session state...");
      const data = await fetchSession();
      if (data) {
        console.log("[Init] Session state received", {
          status: data.session.status,
          participants: data.participants.length,
          maxPlayers: data.session.maxPlayers,
          myRoleIndex: data.myRoleIndex
        });
        determineViewState(data);
        // If in lobby but full, force a refresh after a moment to catch status update
        if (data.session.status === "lobby" && data.participants.length >= data.session.maxPlayers) {
          console.log("[Init] Lobby is full, scheduling refresh...");
          setTimeout(async () => {
            const updated = await fetchSession();
            if (updated) {
              console.log("[Init] Refreshed after lobby full", { status: updated.session.status });
              determineViewState(updated);
            }
          }, 1000);
        }
      }
    };

    init();
  }, [isReady, initData, sessionId, joinSession, fetchSession, determineViewState]);

  // Polling - refresh session state periodically
  useEffect(() => {
    if (!initData) return;
    // Always poll if in lobby, wait, rendering, or finish states
    // Also poll in record state if multiplayer (to catch when other player joins)
    if (!["lobby", "wait", "rendering", "finish", "record"].includes(viewState)) return;

    const interval = setInterval(async () => {
      const data = await fetchSession();
      if (data) {
        determineViewState(data);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [viewState, initData, fetchSession, determineViewState]);

  const handleRecordComplete = async (audioBlob: Blob) => {
    if (!initData) return;

    try {
      console.log("[Record] Starting upload...");
      await api.uploadTake(initData, sessionId, audioBlob);
      console.log("[Record] Upload success, fetching session...");
      setHasRecorded(true);
      const data = await fetchSession();
      if (data) {
        console.log("[Record] Session fetched:", {
          myRoleIndex: data.myRoleIndex,
          takes: data.takes.length,
          totalCues: data.session.sceneMeta.cues.length,
        });
        determineViewState(data);
      }
    } catch (err) {
      console.error("Upload failed:", err);
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    }
  };

  const handleRetake = () => {
    if (!retakeUsed) {
      setRetakeUsed(true);
      setHasRecorded(false);
    }
  };

  const handleFinish = async () => {
    if (!initData || finishing) return;
    setFinishing(true);
    try {
      await api.finishSession(initData, sessionId);
      setViewState("rendering");
    } catch (err) {
      console.error("Finish failed:", err);
      setError(err instanceof Error ? err.message : "Ошибка");
      setFinishing(false); // Reset on error
    }
  };

  const handleSkipScene = async () => {
    if (!initData || !session || skipInProgress) return;

    setSkipError(null);
    setError(null);

    if (session.takes.length > 0) {
      setSkipError(RU.web.session.skipNotAllowedAfterFirstTake);
      return;
    }

    if (session.session.maxPlayers === 2 && session.session.createdByTgUserId !== user?.id) {
      setSkipError(RU.web.session.skipHostOnly);
      return;
    }

    try {
      setSkipInProgress(true);
      const updated = await api.skipScene(initData, sessionId);
      setSession(updated);
      determineViewState(updated);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "SKIP_NOT_ALLOWED_AFTER_FIRST_TAKE") {
        setSkipError(RU.web.session.skipNotAllowedAfterFirstTake);
      } else if (code === "SKIP_LIMIT_REACHED") {
        setSkipError(RU.web.session.skipLimitReached);
      } else if (code === "SKIP_HOST_ONLY") {
        setSkipError(RU.web.session.skipHostOnly);
      } else {
        setSkipError(RU.web.session.skipFailed);
      }
    } finally {
      setSkipInProgress(false);
    }
  };

  // Removed copyInviteLink - now using session code instead

  // Loading
  if (viewState === "loading" || !isReady) {
    return (
      <PageShell>
        <div className="flex-1 flex items-center justify-center min-h-[70vh]">
          <Card className="text-center space-y-4">
            <div className="w-12 h-12 border-3 border-accent-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-tg-hint">????????????????...</p>
          </Card>
        </div>
      </PageShell>
    );
  }

  // Error  // Error
  if (viewState === "error") {
    const isAuthError = error?.includes("??????????????????????") || error?.includes("initData");
    const tgAvailable = typeof window !== 'undefined' && !!window.Telegram?.WebApp;

    return (
      <PageShell>
        <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-[70vh]">
          <Card className="text-center space-y-4">
            <div className="text-5xl">????</div>
            <h2 className="text-xl font-bold">????????????</h2>
            <p className="text-tg-hint">{error}</p>

            {/* Diagnostic info */}
            <div className="text-xs text-tg-hint bg-white/5 p-3 rounded-2xl text-left border border-white/10">
              <p>TG WebApp: {tgAvailable ? '???' : '???'}</p>
              <p>initData: {initData ? '???' : '???'}</p>
              <p>Session: {sessionId.slice(-8)}</p>
              <p>window.Telegram: {typeof window !== 'undefined' && 'Telegram' in window ? '???' : '???'}</p>
              <p>URL: {typeof window !== 'undefined' ? window.location.pathname : '?'}</p>
            </div>

            <div className="flex flex-col gap-2">
              {isAuthError && (
                <>
                  <Button
                    variant="primary"
                    onClick={() => {
                      retry();
                      setViewState("loading");
                      setError(null);
                    }}
                  >
                    ???? ?????????????????????? ??????????
                  </Button>
                  <p className="text-xs text-tg-hint mt-2">
                    ???????? ???? ????????????????, ???????????????? ???????????????????? ?? ???????????????? ???????????? ?????????? ????????
                  </p>
                </>
              )}
              <Button
                variant="secondary"
                onClick={() => router.push("/")}
              >
                ???? ??????????????
              </Button>
            </div>
          </Card>
        </div>
      </PageShell>
    );
  }

  // Lobby  // Lobby
  if (viewState === "lobby" && session) {
    const canSkipScene =
      session.takes.length === 0 &&
      (session.session.maxPlayers === 1 || session.session.createdByTgUserId === user?.id);
    return (
      <PageShell>
      <div className="flex-1 flex flex-col p-6">
        <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full space-y-6">
          <div className="text-center animate-slide-up">
            <div className="badge mb-4">Лобби</div>
            <h1 className="text-2xl font-bold mb-2">
              {session.participants.length} / {session.session.maxPlayers}
            </h1>
            <p className="text-tg-hint">
              {session.participants.length >= session.session.maxPlayers
                ? "Все готовы! Скоро начнём..."
                : "Ожидаем игроков"}
            </p>
          </div>

          {/* Category + Task */}
          <Card className="text-center animate-fade-in">
            <div className="text-sm text-tg-hint mb-2">
              {CATEGORY_LABELS[session.session.category] || session.session.category}
            </div>
            {session.session.gameMode === "tasks" && session.session.task && (
              <>
                <div className="text-xs text-tg-hint mt-3 mb-1">📝 Задание</div>
                <div className="text-lg font-medium">{session.session.task}</div>
              </>
            )}
            {session.session.gameMode === "improv" && (
              <div className="text-lg font-medium">🎭 Импровизация</div>
            )}
          </Card>

          {/* Players */}
          <Card className="space-y-3 animate-fade-in" style={{ animationDelay: "0.1s" }}>
            {session.participants.map((p, i) => (
              <div
                key={p.id}
                className="flex items-center gap-3 p-3 bg-tg-bg rounded-xl"
              >
                <div className="w-10 h-10 rounded-full bg-accent-primary/20 flex items-center justify-center font-bold text-accent-primary">
                  {i + 1}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{p.displayName}</div>
                  {p.tgUserId === user?.id && (
                    <div className="text-xs text-accent-primary">Это вы</div>
                  )}
                </div>
              </div>
            ))}
            {Array.from({
              length: session.session.maxPlayers - session.participants.length,
            }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="flex items-center gap-3 p-3 bg-tg-bg/50 rounded-xl border border-dashed border-white/10"
              >
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-tg-hint">
                  ?
                </div>
                <span className="text-tg-hint">Ожидаем...</span>
              </div>
            ))}
          </Card>

          {/* Session Code & Instructions */}
          {session.session.maxPlayers > 1 && (
            <SessionCodeCard sessionId={sessionId} />
          )}

          {canSkipScene && (
            <div className="space-y-2">
              <Button variant="secondary"
                onClick={handleSkipScene}
                disabled={skipInProgress}
                 className="w-full disabled:opacity-70"
              >
                {skipInProgress ? "..." : RU.web.session.skipScene}
              </Button>
              {skipError && (
                <div className="text-red-400 text-sm text-center">{skipError}</div>
              )}
            </div>
          )}
        </div>
      </div>
      </PageShell>
    );
  }

  // Record
  if (viewState === "record" && session && joinData) {
    const myCue = session.session.sceneMeta.cues.find(
      (c) => c.roleIndex === session.myRoleIndex
    );
    const cueDuration = myCue?.durationSec || 5;
    const isSolo = session.session.maxPlayers === 1;
    const totalRoles = session.session.sceneMeta.cues.length;
    const currentRoleNum = (session.myRoleIndex ?? 0) + 1;
    const canSkipScene =
      session.takes.length === 0 &&
      (session.session.maxPlayers === 1 || session.session.createdByTgUserId === user?.id);

    return (
      <PageShell>
      <div className="flex-1 flex flex-col p-6 overflow-y-auto">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full space-y-5">
          {/* Header */}
          <div className="text-center animate-slide-up">
            <div className="badge mb-3">
              {isSolo ? `Реплика ${currentRoleNum} из ${totalRoles}` : "Ваш ход"}
            </div>
            <h1 className="text-xl font-bold">
              {isSolo ? `Озвучьте роль ${currentRoleNum}` : `Игрок ${currentRoleNum}`}
            </h1>
          </div>

          {/* Task (only in tasks mode) */}
          {session.session.gameMode === "tasks" && session.session.task && (
            <Card className="text-center animate-fade-in">
              <div className="text-sm text-tg-hint mb-1">📝 Задание</div>
              <div className="font-medium">{session.session.task}</div>
            </Card>
          )}

          {canSkipScene && (
            <div className="animate-fade-in" style={{ animationDelay: "0.03s" }}>
              <Button variant="secondary"
                onClick={handleSkipScene}
                disabled={skipInProgress}
                 className="w-full disabled:opacity-70"
              >
                {skipInProgress ? "..." : RU.web.session.skipScene}
              </Button>
              {skipError && (
                <div className="text-red-400 text-sm text-center mt-2">{skipError}</div>
              )}
            </div>
          )}

          {/* Full scene with original audio */}
          <Card className="animate-fade-in" style={{ animationDelay: "0.05s" }}>
            <VideoPlayer
              key={`full-${session.myRoleIndex}`}
              src={session.sceneUrl}
              srcCuts={session.sceneUrlCuts}
              muted={false}
              showTimeRange={false}
              label="📺 Посмотри сцену:"
              showAudioModeSwitch={true}
            />
          </Card>

          {/* Your fragment to dub */}
          <Card className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <div className="text-sm text-tg-hint mb-2">
              🎬 Твой фрагмент для озвучки ({cueDuration.toFixed(1)} сек):
            </div>
            <VideoPlayer
              key={`fragment-${session.myRoleIndex}`}
              src={session.sceneUrl}
              srcCuts={session.sceneUrlCuts}
              startTime={myCue?.startSec || 0}
              endTime={myCue ? myCue.startSec + myCue.durationSec : undefined}
              muted={false}
              showTimeRange={true}
              showAudioModeSwitch={true}
            />
          </Card>

          {/* Recorder */}
          <Card className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
            <VoiceRecorder
              key={`recorder-${session.myRoleIndex}`}
              maxDuration={cueDuration}
              onRecordComplete={handleRecordComplete}
              disabled={hasRecorded && retakeUsed}
            />
          </Card>

          {/* Retake */}
          {hasRecorded && !retakeUsed && (
            <Button variant="secondary" onClick={handleRetake}  className="w-full">
              🔄 Перезаписать (1 раз)
            </Button>
          )}

          {error && (
            <div className="text-red-400 text-sm text-center">{error}</div>
          )}
        </div>
      </div>
      </PageShell>
    );
  }

  // Wait
  if (viewState === "wait" && session) {
    const myCue = session.session.sceneMeta.cues.find(
      (c) => c.roleIndex === session.myRoleIndex
    );
    
    return (
      <PageShell>
      <div className="flex-1 flex flex-col p-6 overflow-y-auto">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full space-y-5">
          {/* Header */}
          <div className="text-center animate-slide-up">
            <div className="w-12 h-12 border-4 border-accent-secondary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Ожидаем других</h2>
            <p className="text-tg-hint">
              Записано: {session.takes.length} / {session.session.maxPlayers}
            </p>
          </div>

          {/* Task (if tasks mode) */}
          {session.session.gameMode === "tasks" && session.session.task && (
            <Card className="text-center animate-fade-in">
              <div className="text-sm text-tg-hint mb-1">📝 Задание</div>
              <div className="font-medium">{session.session.task}</div>
            </Card>
          )}

          {/* Full scene with original audio */}
          <Card className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <VideoPlayer
              key={`wait-full`}
              src={session.sceneUrl}
              srcCuts={session.sceneUrlCuts}
              muted={false}
              showTimeRange={false}
              label="📺 Посмотри сцену пока ждёшь:"
              showAudioModeSwitch={true}
            />
          </Card>

          {/* Your fragment to dub */}
          {myCue && (
            <Card className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
              <div className="text-sm text-tg-hint mb-2">
                🎬 Твой фрагмент для озвучки ({myCue.durationSec.toFixed(1)} сек):
              </div>
              <VideoPlayer
                key={`wait-fragment`}
                src={session.sceneUrl}
                srcCuts={session.sceneUrlCuts}
                startTime={myCue.startSec}
                endTime={myCue.startSec + myCue.durationSec}
                muted={false}
                showTimeRange={true}
                showAudioModeSwitch={true}
              />
            </Card>
          )}
        </div>
      </div>
      </PageShell>
    );
  }

  // Finish
  if (viewState === "finish" && session) {
    const isSolo = session.session.maxPlayers === 1;
    // In solo mode, user can always start render
    // In multiplayer, any participant who recorded can start (API will check if they're last)
    const myTakeExists = session.myRoleIndex !== null && session.takes.some(
      (t) => t.roleIndex === session.myRoleIndex
    );
    const canStartRender = isSolo || myTakeExists;

    return (
      <PageShell>
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <Card className="text-center space-y-6 animate-slide-up max-w-sm">
          <div className="text-5xl">🎬</div>
          <div>
            <h2 className="text-2xl font-bold mb-2">Все записали!</h2>
            <p className="text-tg-hint">
              {canStartRender
                ? "Нажми, чтобы собрать видео"
                : "Ждём, пока последний игрок запустит сборку"}
            </p>
          </div>
          {canStartRender && (
            <Button variant="primary" 
              onClick={handleFinish} 
              disabled={finishing}
               className="text-lg px-8 py-4 disabled:opacity-70"
            >
              {finishing ? "⏳ Собираем..." : "✨ Собрать видео"}
            </Button>
          )}
        </Card>
      </div>
      </PageShell>
    );
  }

  // Rendering
  if (viewState === "rendering") {
    return (
      <PageShell>
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <Card className="text-center space-y-6 animate-slide-up">
          <div className="relative w-20 h-20 mx-auto">
            <div className="w-full h-full border-4 border-accent-primary border-t-transparent rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-2xl">
              🎥
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold mb-2">Рендерим видео</h2>
            <p className="text-tg-hint">Это займёт минуту...</p>
          </div>
        </Card>
      </div>
      </PageShell>
    );
  }

  return null;
}
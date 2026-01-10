"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { PlyrVideoPlayer } from "@/components/PlyrVideoPlayer";
import type { SessionStateResponse, JoinSessionResponse } from "@dubdub/shared";

interface PageProps {
  params: { sessionId: string };
}

type ViewState = "loading" | "error" | "lobby" | "record" | "wait" | "finish" | "rendering";

const CATEGORY_LABELS: Record<string, string> = {
  movies: "🎬 Кино/сериалы",
  memes: "😂 Мемы",
  politics: "🏛️ Политика",
};

function SessionCodeCard({ sessionId }: { sessionId: string }) {
  const sessionCode = sessionId.slice(-8).toUpperCase();
  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME || "DubDubBot";
  
  // Message for sharing - code in backticks makes it copyable in Telegram
  const shareText = `🎬 Присоединяйся к озвучке!

Код: \`${sessionCode}\`

Нажми 👥 Присоединиться в боте @${botUsername} и введи код`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(sessionCode);
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
    // Show brief feedback
    const codeEl = document.querySelector('[data-code-btn]') as HTMLElement;
    if (codeEl) {
      const original = codeEl.textContent;
      codeEl.textContent = "✅ Скопировано!";
      setTimeout(() => { if (codeEl) codeEl.textContent = original; }, 2000);
    }
  };

  const handleSendToFriend = () => {
    // Telegram share requires url parameter, but we make text the focus
    // The url will show as a small preview at the bottom
    const botLink = `https://t.me/${botUsername}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(botLink)}&text=${encodeURIComponent(shareText)}`;
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
  };

  return (
    <div className="card animate-fade-in" style={{ animationDelay: "0.2s" }}>
      <div className="text-center space-y-4">
        <div>
          <div className="text-xs text-tg-hint mb-2">Код для присоединения</div>
          <button
            onClick={handleCopyCode}
            data-code-btn
            className="text-3xl font-bold tracking-wider text-accent-primary hover:text-accent-primary/80 underline cursor-pointer transition-colors"
          >
            {sessionCode}
          </button>
        </div>
        
        <button
          onClick={handleSendToFriend}
          className="btn-tg w-full"
        >
          📤 Отправить другу
        </button>
      </div>
    </div>
  );
}

export default function SessionPage({ params }: PageProps) {
  const { sessionId } = params;
  const router = useRouter();
  const { isReady, initData, user } = useTelegram();

  const [viewState, setViewState] = useState<ViewState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionStateResponse | null>(null);
  const [joinData, setJoinData] = useState<JoinSessionResponse | null>(null);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [retakeUsed, setRetakeUsed] = useState(false);

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
    if (!initData) return;
    try {
      await api.finishSession(initData, sessionId);
      setViewState("rendering");
    } catch (err) {
      console.error("Finish failed:", err);
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  };

  // Removed copyInviteLink - now using session code instead

  // Loading
  if (viewState === "loading" || !isReady) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-3 border-accent-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-tg-hint">Загрузка...</p>
        </div>
      </div>
    );
  }

  // Error
  if (viewState === "error") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="text-5xl">😕</div>
          <h2 className="text-xl font-bold">Ошибка</h2>
          <p className="text-tg-hint">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="btn-secondary"
          >
            На главную
          </button>
        </div>
      </div>
    );
  }

  // Lobby
  if (viewState === "lobby" && session) {
    return (
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
          <div className="card text-center animate-fade-in">
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
          </div>

          {/* Players */}
          <div className="card space-y-3 animate-fade-in" style={{ animationDelay: "0.1s" }}>
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
          </div>

          {/* Session Code & Instructions */}
          {session.session.maxPlayers > 1 && (
            <SessionCodeCard sessionId={sessionId} />
          )}
        </div>
      </div>
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

    return (
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
            <div className="card text-center animate-fade-in">
              <div className="text-sm text-tg-hint mb-1">📝 Задание</div>
              <div className="font-medium">{session.session.task}</div>
            </div>
          )}

          {/* Full scene with original audio */}
          <div className="animate-fade-in" style={{ animationDelay: "0.05s" }}>
            <PlyrVideoPlayer
              key={`full-${session.myRoleIndex}`}
              src={session.sceneUrl}
              srcCuts={session.sceneUrlCuts}
              muted={false}
              showTimeRange={false}
              label="📺 Посмотри сцену:"
              showAudioModeSwitch={true}
            />
          </div>

          {/* Your fragment to dub */}
          <div className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <div className="text-sm text-tg-hint mb-2">
              🎬 Твой фрагмент для озвучки ({cueDuration.toFixed(1)} сек):
            </div>
            <PlyrVideoPlayer
              key={`fragment-${session.myRoleIndex}`}
              src={session.sceneUrl}
              startTime={myCue?.startSec || 0}
              endTime={myCue ? myCue.startSec + myCue.durationSec : undefined}
              muted={true}
              showTimeRange={true}
            />
          </div>

          {/* Recorder */}
          <div className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
            <VoiceRecorder
              key={`recorder-${session.myRoleIndex}`}
              maxDuration={cueDuration}
              onRecordComplete={handleRecordComplete}
              disabled={hasRecorded && retakeUsed}
            />
          </div>

          {/* Retake */}
          {hasRecorded && !retakeUsed && (
            <button onClick={handleRetake} className="btn-secondary w-full">
              🔄 Перезаписать (1 раз)
            </button>
          )}

          {error && (
            <div className="text-red-400 text-sm text-center">{error}</div>
          )}
        </div>
      </div>
    );
  }

  // Wait
  if (viewState === "wait" && session) {
    const myCue = session.session.sceneMeta.cues.find(
      (c) => c.roleIndex === session.myRoleIndex
    );
    
    return (
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
            <div className="card text-center animate-fade-in">
              <div className="text-sm text-tg-hint mb-1">📝 Задание</div>
              <div className="font-medium">{session.session.task}</div>
            </div>
          )}

          {/* Full scene with original audio */}
          <div className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <PlyrVideoPlayer
              key={`wait-full`}
              src={session.sceneUrl}
              srcCuts={session.sceneUrlCuts}
              muted={false}
              showTimeRange={false}
              label="📺 Посмотри сцену пока ждёшь:"
              showAudioModeSwitch={true}
            />
          </div>

          {/* Your fragment to dub */}
          {myCue && (
            <div className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
              <div className="text-sm text-tg-hint mb-2">
                🎬 Твой фрагмент для озвучки ({myCue.durationSec.toFixed(1)} сек):
              </div>
              <PlyrVideoPlayer
                key={`wait-fragment`}
                src={session.sceneUrl}
                startTime={myCue.startSec}
                endTime={myCue.startSec + myCue.durationSec}
                muted={true}
                showTimeRange={true}
              />
            </div>
          )}
        </div>
      </div>
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
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-6 animate-slide-up max-w-sm">
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
            <button onClick={handleFinish} className="btn-primary text-lg px-8 py-4">
              ✨ Собрать видео
            </button>
          )}
        </div>
      </div>
    );
  }

  // Rendering
  if (viewState === "rendering") {
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
            <p className="text-tg-hint">Это займёт минуту...</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

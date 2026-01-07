"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/TelegramProvider";
import { api } from "@/lib/api";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { VideoPlayer } from "@/components/VideoPlayer";
import type { SessionStateResponse, JoinSessionResponse } from "@dubdub/shared";

interface PageProps {
  params: { sessionId: string };
}

type ViewState = "loading" | "error" | "lobby" | "record" | "wait" | "finish" | "rendering";

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
    if (!initData) return;
    try {
      const data = await api.joinSession(initData, sessionId);
      setJoinData(data);
      return data;
    } catch (err) {
      console.error("Join failed:", err);
      setError(err instanceof Error ? err.message : "Ошибка входа");
      setViewState("error");
    }
  }, [initData, sessionId]);

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
      const allRolesRecorded = data.takes.length >= totalRoles;

      // In solo mode, check if all roles recorded (not just maxPlayers)
      // In multiplayer mode, check if all players recorded
      const requiredRecordings = isSolo ? totalRoles : data.session.maxPlayers;

      if (data.takes.length >= requiredRecordings) {
        setViewState("finish");
        return;
      }

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
        // Multiplayer logic
        const myTakeExists = data.takes.some(
          (t) => t.roleIndex === data.myRoleIndex
        );

        if (myTakeExists) {
          setHasRecorded(true);
          if (data.takes.length >= data.session.maxPlayers) {
            setViewState("finish");
          } else {
            setViewState("wait");
          }
          return;
        }

        if (data.currentTurn === data.myRoleIndex) {
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
    if (!isReady || !initData) return;

    const init = async () => {
      const joined = await joinSession();
      if (!joined) return;

      const data = await fetchSession();
      if (data) {
        determineViewState(data);
      }
    };

    init();
  }, [isReady, initData, joinSession, fetchSession, determineViewState]);

  // Polling
  useEffect(() => {
    if (!initData) return;
    if (!["lobby", "wait", "rendering", "finish"].includes(viewState)) return;

    const interval = setInterval(async () => {
      const data = await fetchSession();
      if (data) {
        determineViewState(data);
      }
    }, 2500);

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

  const copyInviteLink = () => {
    const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME || "DubDubBot";
    const link = `https://t.me/${botUsername}?startapp=${sessionId}`;
    navigator.clipboard.writeText(link);
    // Haptic feedback if available
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
  };

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
            <p className="text-tg-hint">Ожидаем игроков</p>
          </div>

          {/* Topic */}
          <div className="card text-center animate-fade-in">
            <div className="text-sm text-tg-hint mb-2">Тема</div>
            <div className="text-lg font-medium">{session.session.topic}</div>
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

          {/* Invite */}
          <button
            onClick={copyInviteLink}
            className="btn-tg w-full animate-fade-in"
            style={{ animationDelay: "0.2s" }}
          >
            📋 Скопировать приглашение
          </button>
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

          {/* Topic */}
          <div className="card text-center animate-fade-in">
            <div className="text-sm text-tg-hint mb-1">Тема</div>
            <div className="font-medium">{session.session.topic}</div>
          </div>

          {/* Full scene with original audio - FIRST */}
          <div className="animate-fade-in" style={{ animationDelay: "0.05s" }}>
            <VideoPlayer
              key={`full-${session.myRoleIndex}`}
              src={session.sceneUrl}
              muted={false}
              showTimeRange={false}
              label="📺 Посмотри всю сцену с оригинальным звуком:"
            />
          </div>

          {/* Preview audio from previous player */}
          {session.previewUrl && session.myRoleIndex !== null && session.myRoleIndex > 0 && (
            <div className="card animate-fade-in" style={{ animationDelay: "0.1s" }}>
              <div className="text-sm text-tg-hint mb-3">
                🎧 Часть предыдущей реплики
                <span className="text-xs ml-2">
                  ({session.myRoleIndex === 1 ? "0-50%" : "50-100%"})
                </span>
              </div>
              <audio src={session.previewUrl} controls className="w-full h-10" />
            </div>
          )}

          {/* Your fragment to dub */}
          <div className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
            <div className="text-sm text-tg-hint mb-2">
              🎬 Твой фрагмент для озвучки ({cueDuration.toFixed(1)} сек):
            </div>
            <VideoPlayer
              key={`fragment-${session.myRoleIndex}`}
              src={session.sceneUrl}
              startTime={myCue?.startSec || 0}
              endTime={myCue ? myCue.startSec + myCue.durationSec : undefined}
              muted={true}
              showTimeRange={true}
            />
          </div>

          {/* Recorder */}
          <div className="animate-fade-in" style={{ animationDelay: "0.2s" }}>
            <VoiceRecorder
              key={`recorder-${session.myRoleIndex}`}
              maxDuration={cueDuration + 2}
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
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-6 animate-slide-up">
          <div className="w-16 h-16 border-4 border-accent-secondary border-t-transparent rounded-full animate-spin mx-auto" />
          <div>
            <h2 className="text-xl font-bold mb-2">Ожидаем других</h2>
            <p className="text-tg-hint">
              Записано: {session.takes.length} / {session.session.maxPlayers}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Finish
  if (viewState === "finish" && session) {
    const isHost = session.session.createdByTgUserId === user?.id;

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-6 animate-slide-up max-w-sm">
          <div className="text-5xl">🎬</div>
          <div>
            <h2 className="text-2xl font-bold mb-2">Все записали!</h2>
            <p className="text-tg-hint">
              {isHost
                ? "Нажми, чтобы собрать видео"
                : "Ждём, пока создатель запустит сборку"}
            </p>
          </div>
          {isHost && (
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

